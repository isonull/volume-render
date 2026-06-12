struct CameraUniform {
  invViewProj: mat4x4f,
  cameraPositionAndFrame: vec4f,
  viewportAndTime: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<storage, read> accumulation: array<vec4f>;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let x = f32((vertexIndex << 1u) & 2u);
  let y = f32(vertexIndex & 2u);
  var out: VertexOut;
  out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2u(camera.viewportAndTime.xy);
  let xy = min(vec2u(position.xy), size - vec2u(1u));
  let accum = accumulation[xy.x + size.x * xy.y];
  let color = accum.rgb / max(accum.a, 1.0);
  let mapped = color / (color + vec3f(1.0));
  let gamma = pow(max(mapped, vec3f(0.0)), vec3f(1.0 / 2.2));
  let uv = position.xy / vec2f(size);
  let bg = vec3f(0.015 + uv.x * 0.025, 0.018 + uv.y * 0.018, 0.028);
  return vec4f(gamma + bg, 1.0);
}
