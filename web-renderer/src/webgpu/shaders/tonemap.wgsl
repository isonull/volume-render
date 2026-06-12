struct CameraUniform {
  invViewProj: mat4x4f,
  cameraPositionAndFrame: vec4f,
  viewportAndTime: vec4f,
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<storage, read> accumulation: array<vec4f>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2u(camera.viewportAndTime.xy);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }

  let index = id.x + size.x * id.y;
  let accum = accumulation[index];
  let color = accum.rgb / max(accum.a, 1.0);
  let mapped = color / (color + vec3f(1.0));
  let gamma = pow(max(mapped, vec3f(0.0)), vec3f(1.0 / 2.2));
  textureStore(outputTexture, id.xy, vec4f(gamma, 1.0));
}
