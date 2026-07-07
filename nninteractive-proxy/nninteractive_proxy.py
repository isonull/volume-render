#!/usr/bin/env python3
"""Same-origin development proxy for nnInteractive.

The browser talks to this proxy with raw C-order array bytes. The proxy talks to
nninteractive-server with the NNIA + blosc2 wire format used by the Python
client. This keeps the browser path usable before a native browser blosc2 codec
is available.
"""

from __future__ import annotations

import argparse
import json
import os
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np

try:
    import blosc2
except ImportError as exc:  # pragma: no cover - startup guard.
    raise SystemExit("nninteractive_proxy.py requires Python packages: numpy blosc2") from exc


META_HEADER = "X-Meta"
LEASE_HEADER = "X-Lease-Token"
MAGIC = b"NNIA"
VERSION = 1
CHUNK_SIZE = 1 << 30
CODEC_ID = {
    blosc2.Codec.ZSTD: 1,
    blosc2.Codec.LZ4: 2,
}
ID_CODEC = {v: k for k, v in CODEC_ID.items()}
HOP_BY_HOP_HEADERS = {
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def pack_array(
    arr: np.ndarray,
    codec: blosc2.Codec = blosc2.Codec.ZSTD,
    clevel: int = 3,
    filters: Iterable["blosc2.Filter"] | None = None,
) -> bytes:
    arr = np.ascontiguousarray(arr)
    if arr.dtype.byteorder not in ("=", "|", "<"):
        arr = arr.astype(arr.dtype.newbyteorder("<"))
    dtype_name = np.dtype(arr.dtype).name.encode("ascii")
    if len(dtype_name) > 255:
        raise ValueError(f"dtype name too long: {dtype_name!r}")

    header = struct.pack(
        f"<4sBBBB{len(dtype_name)}s",
        MAGIC,
        VERSION,
        CODEC_ID[codec],
        arr.ndim,
        len(dtype_name),
        dtype_name,
    )
    shape_bytes = struct.pack(f"<{arr.ndim}q", *arr.shape)
    raw = memoryview(arr).cast("B")
    total = raw.nbytes
    nchunks = (total + CHUNK_SIZE - 1) // CHUNK_SIZE
    typesize = arr.dtype.itemsize
    filters = list(filters or [blosc2.Filter.SHUFFLE])

    parts = [header, shape_bytes, struct.pack("<I", nchunks)]
    for chunk_index in range(nchunks):
        start = chunk_index * CHUNK_SIZE
        end = min(start + CHUNK_SIZE, total)
        chunk = blosc2.compress2(
            raw[start:end],
            typesize=typesize,
            codec=codec,
            clevel=clevel,
            filters=filters,
        )
        parts.append(struct.pack("<QQ", end - start, len(chunk)))
        parts.append(chunk)
    return b"".join(parts)


def unpack_array(buf: bytes) -> np.ndarray:
    if len(buf) < 8:
        raise ValueError("packed array too short")
    magic, version, codec_id, ndim, dtype_len = struct.unpack_from("<4sBBBB", buf, 0)
    if magic != MAGIC:
        raise ValueError(f"bad magic: {magic!r}")
    if version != VERSION:
        raise ValueError(f"unsupported wire version {version}")
    if codec_id not in ID_CODEC:
        raise ValueError(f"unsupported codec id {codec_id}")

    offset = 8
    dtype = np.dtype(buf[offset : offset + dtype_len].decode("ascii"))
    offset += dtype_len
    shape = struct.unpack_from(f"<{ndim}q", buf, offset)
    offset += ndim * 8
    (nchunks,) = struct.unpack_from("<I", buf, offset)
    offset += 4

    nelem = 1
    for dim in shape:
        nelem *= dim
    out = np.empty(nelem, dtype=dtype)
    out_view = memoryview(out).cast("B")
    written = 0
    for _ in range(nchunks):
        ulen, clen = struct.unpack_from("<QQ", buf, offset)
        offset += 16
        chunk = blosc2.decompress2(buf[offset : offset + clen])
        offset += clen
        if len(chunk) != ulen:
            raise ValueError(f"chunk size mismatch: expected {ulen}, got {len(chunk)}")
        if written + ulen > out_view.nbytes:
            raise ValueError("payload larger than declared array shape")
        out_view[written : written + ulen] = chunk
        written += ulen
    if written != out_view.nbytes:
        raise ValueError(f"payload size mismatch: expected {out_view.nbytes}, got {written}")
    return out.reshape(shape)


class ProxyHandler(BaseHTTPRequestHandler):
    server_version = "nnInteractiveRawProxy/0.3"
    proxy_features = ("raw_set_image", "raw_mask_interactions", "raw_initial_segmentation", "raw_prediction_patches")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Lease-Token, X-Meta")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] == "/__raw_proxy_info":
            self._send_json(
                200,
                {
                    "name": "nnInteractiveRawProxy",
                    "version": 3,
                    "features": list(self.proxy_features),
                    "target": self.server.target_url,
                },
            )
            return
        self._forward_raw()

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] == "/set_image":
            self._handle_set_image()
            return
        if self.path.split("?", 1)[0] == "/add_scribble_interaction":
            self._handle_mask_interaction("/add_scribble_interaction")
            return
        if self.path.split("?", 1)[0] == "/add_initial_seg_interaction":
            self._handle_initial_segmentation()
            return
        if self.path.split("?", 1)[0] in {
            "/add_point_interaction",
            "/add_bbox_interaction",
            "/undo",
        }:
            self._forward_prediction()
            return
        self._forward_raw()

    def _handle_set_image(self) -> None:
        try:
            meta = self._meta()
            shape = tuple(int(dim) for dim in meta["shape"])
            dtype = np.dtype(str(meta["dtype"]))
            body = self._read_body()
            arr = np.frombuffer(body, dtype=dtype)
            expected = int(np.prod(shape, dtype=np.uint64))
            if arr.size != expected:
                raise ValueError(f"raw image has {arr.size} elements, expected {expected}")
            packed = pack_array(arr.reshape(shape), filters=[blosc2.Filter.SHUFFLE])
            server_meta = {"image_properties": meta.get("image_properties") or {}}
            headers = self._forward_headers()
            headers.update({
                META_HEADER: json.dumps(server_meta, separators=(",", ":")),
                "Content-Type": "application/octet-stream",
            })
            self._forward_body(
                method="POST",
                path="/set_image",
                body=packed,
                headers=headers,
                timeout=600,
            )
        except Exception as exc:
            self._send_json(400, {"detail": str(exc)})

    def _handle_initial_segmentation(self) -> None:
        try:
            meta = self._meta()
            shape = tuple(int(dim) for dim in meta["shape"])
            dtype = np.dtype(str(meta.get("dtype", "uint8")))
            body = self._read_body()
            arr = np.frombuffer(body, dtype=dtype)
            expected = int(np.prod(shape, dtype=np.uint64))
            if arr.size != expected:
                raise ValueError(f"raw initial segmentation has {arr.size} elements, expected {expected}")
            packed = pack_array(arr.reshape(shape), filters=[blosc2.Filter.NOFILTER])
            server_meta = {
                "run_prediction": bool(meta.get("run_prediction", False)),
                "override_capability_checks": bool(meta.get("override_capability_checks", False)),
            }
            headers = self._forward_headers()
            headers.update({
                META_HEADER: json.dumps(server_meta, separators=(",", ":")),
                "Content-Type": "application/octet-stream",
            })
            response = self._request_upstream(
                method="POST",
                path="/add_initial_seg_interaction",
                body=packed,
                headers=headers,
                timeout=600,
            )
            if response is None:
                return
            self._send_prediction_response(response)
        except Exception as exc:
            self._send_json(400, {"detail": str(exc)})

    def _forward_prediction(self) -> None:
        response = self._request_upstream(
            method="POST",
            path=self.path,
            body=self._read_body(),
            headers=self._forward_headers(),
            timeout=600,
        )
        if response is None:
            return
        self._send_prediction_response(response)

    def _handle_mask_interaction(self, path: str) -> None:
        try:
            meta = self._meta()
            shape = tuple(int(dim) for dim in meta["shape"])
            dtype = np.dtype(str(meta.get("dtype", "uint8")))
            body = self._read_body()
            arr = np.frombuffer(body, dtype=dtype)
            expected = int(np.prod(shape, dtype=np.uint64))
            if arr.size != expected:
                raise ValueError(f"raw mask has {arr.size} elements, expected {expected}")
            packed = pack_array(arr.reshape(shape), filters=[blosc2.Filter.NOFILTER])
            server_meta = {
                "include_interaction": bool(meta["include_interaction"]),
                "run_prediction": bool(meta.get("run_prediction", True)),
                "override_capability_checks": bool(meta.get("override_capability_checks", False)),
                "interaction_bbox": meta.get("interaction_bbox"),
            }
            headers = self._forward_headers()
            headers.update({
                META_HEADER: json.dumps(server_meta, separators=(",", ":")),
                "Content-Type": "application/octet-stream",
            })
            response = self._request_upstream(
                method="POST",
                path=path,
                body=packed,
                headers=headers,
                timeout=600,
            )
            if response is None:
                return
            self._send_prediction_response(response)
        except Exception as exc:
            self._send_json(400, {"detail": str(exc)})

    def _send_prediction_response(self, response: tuple[int, dict[str, str], bytes]) -> None:
        status, headers, body = response
        meta_raw = get_header(headers, META_HEADER)
        if not body or not meta_raw:
            self._send(status, headers, body)
            return
        try:
            meta = json.loads(meta_raw)
            if not meta.get("ran_prediction") or meta.get("bbox") is None:
                self._send(status, headers, body)
                return
            diff = unpack_array(body)
            meta["dtype"] = str(diff.dtype)
            meta["shape"] = list(diff.shape)
            self._send(
                status,
                {
                    META_HEADER: json.dumps(meta, separators=(",", ":")),
                    "Content-Type": "application/octet-stream",
                },
                diff.tobytes(order="C"),
            )
        except Exception as exc:
            self._send_json(502, {"detail": f"failed to decode upstream prediction: {exc}"})

    def _forward_raw(self) -> None:
        self._forward_body(
            method=self.command,
            path=self.path,
            body=self._read_body() if self.command == "POST" else None,
            headers=self._forward_headers(),
            timeout=600,
        )

    def _forward_body(self, method: str, path: str, body: bytes | None, headers: dict[str, str], timeout: int) -> None:
        response = self._request_upstream(method, path, body, headers, timeout)
        if response is None:
            return
        status, response_headers, response_body = response
        self._send(status, response_headers, response_body)

    def _request_upstream(
        self,
        method: str,
        path: str,
        body: bytes | None,
        headers: dict[str, str],
        timeout: int,
    ) -> tuple[int, dict[str, str], bytes] | None:
        target = self.server.target_url.rstrip("/") + path
        req = Request(target, data=body, method=method, headers=headers)
        try:
            with urlopen(req, timeout=timeout) as response:
                return response.status, dict(response.headers.items()), response.read()
        except HTTPError as exc:
            return exc.code, dict(exc.headers.items()), exc.read()
        except URLError as exc:
            self._send_json(502, {"detail": f"upstream unavailable: {exc.reason}"})
            return None

    def _forward_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        for name in ("Authorization", LEASE_HEADER, META_HEADER, "Content-Type"):
            value = self.headers.get(name)
            if value:
                headers[name] = value
        return headers

    def _meta(self) -> dict:
        raw = self.headers.get(META_HEADER)
        if not raw:
            return {}
        return json.loads(raw)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(length) if length else b""

    def _send_json(self, status: int, payload: dict) -> None:
        self._send(status, {"Content-Type": "application/json"}, json.dumps(payload).encode("utf-8"))

    def _send(self, status: int, headers: dict[str, str], body: bytes) -> None:
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", META_HEADER)
        for name, value in headers.items():
            if name.lower() not in HOP_BY_HOP_HEADERS:
                self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")


class ProxyServer(ThreadingHTTPServer):
    target_url: str


def get_header(headers: dict[str, str], name: str) -> str | None:
    lower_name = name.lower()
    for key, value in headers.items():
        if key.lower() == lower_name:
            return value
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Raw-array proxy for nninteractive-server.")
    parser.add_argument("--host", default=os.environ.get("NNINTERACTIVE_PROXY_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("NNINTERACTIVE_PROXY_PORT", "1528")))
    parser.add_argument(
        "--target",
        default=os.environ.get("NNINTERACTIVE_SERVER_URL", "http://127.0.0.1:1527"),
        help="Upstream nninteractive-server URL.",
    )
    args = parser.parse_args()

    server = ProxyServer((args.host, args.port), ProxyHandler)
    server.target_url = args.target
    print(f"nnInteractive raw proxy listening on http://{args.host}:{args.port}")
    print(f"Forwarding to {args.target}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
