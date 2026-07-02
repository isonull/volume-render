struct MprUniforms {
  origin: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  worldToIndex0: vec4<f32>,
  worldToIndex1: vec4<f32>,
  worldToIndex2: vec4<f32>,
  worldToIndex3: vec4<f32>,
  dims: vec4<u32>,
  canvasSize: vec4<f32>,
  window: vec4<f32>,
};

@group(0) @binding(0) var<uniform> mpr: MprUniforms;
@group(0) @binding(1) var volumeTex: texture_3d<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return out;
}

fn world_to_index(world: vec3<f32>) -> vec3<f32> {
  let p = vec4<f32>(world, 1.0);
  return vec3<f32>(
    dot(mpr.worldToIndex0, p),
    dot(mpr.worldToIndex1, p),
    dot(mpr.worldToIndex2, p),
  );
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let dx = fragCoord.x - 0.5 * mpr.canvasSize.x;
  let dy = fragCoord.y - 0.5 * mpr.canvasSize.y;
  let world = mpr.origin.xyz
    + dx * mpr.window.z * mpr.right.xyz
    - dy * mpr.window.z * mpr.up.xyz;
  let index = world_to_index(world);
  let dims = vec3<f32>(vec3<u32>(mpr.dims.xyz));

  if (any(index < vec3<f32>(0.0)) || any(index > dims - vec3<f32>(1.0))) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let voxel = vec3<i32>(round(index));
  let raw = textureLoad(volumeTex, voxel, 0).r;
  let gray = clamp((raw - mpr.window.x) / max(1e-6, mpr.window.y - mpr.window.x), 0.0, 1.0);
  return vec4<f32>(gray, gray, gray, 1.0);
}
