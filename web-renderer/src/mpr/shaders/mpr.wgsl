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
  options: vec4<u32>,
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

fn in_bounds(index: vec3<f32>) -> bool {
  let dims = vec3<f32>(vec3<u32>(mpr.dims.xyz));
  return !any(index < vec3<f32>(0.0)) && !any(index > dims - vec3<f32>(1.0));
}

fn load_voxel(index: vec3<i32>) -> f32 {
  let maxIndex = vec3<i32>(vec3<u32>(mpr.dims.xyz) - vec3<u32>(1u));
  return textureLoad(volumeTex, clamp(index, vec3<i32>(0), maxIndex), 0).r;
}

fn sample_nearest(index: vec3<f32>) -> f32 {
  return load_voxel(vec3<i32>(round(index)));
}

fn sample_linear(index: vec3<f32>) -> f32 {
  let baseF = floor(index);
  let frac = index - baseF;
  let base = vec3<i32>(baseF);
  let x0 = load_voxel(base + vec3<i32>(0, 0, 0));
  let x1 = load_voxel(base + vec3<i32>(1, 0, 0));
  let y0 = mix(x0, x1, frac.x);
  let x2 = load_voxel(base + vec3<i32>(0, 1, 0));
  let x3 = load_voxel(base + vec3<i32>(1, 1, 0));
  let y1 = mix(x2, x3, frac.x);
  let z0 = mix(y0, y1, frac.y);

  let x4 = load_voxel(base + vec3<i32>(0, 0, 1));
  let x5 = load_voxel(base + vec3<i32>(1, 0, 1));
  let y2 = mix(x4, x5, frac.x);
  let x6 = load_voxel(base + vec3<i32>(0, 1, 1));
  let x7 = load_voxel(base + vec3<i32>(1, 1, 1));
  let y3 = mix(x6, x7, frac.x);
  let z1 = mix(y2, y3, frac.y);

  return mix(z0, z1, frac.z);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let dx = fragCoord.x - 0.5 * mpr.canvasSize.x;
  let dy = fragCoord.y - 0.5 * mpr.canvasSize.y;
  let world = mpr.origin.xyz
    + dx * mpr.window.z * mpr.right.xyz
    - dy * mpr.window.z * mpr.up.xyz;
  let index = world_to_index(world);

  if (!in_bounds(index)) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let raw = select(sample_nearest(index), sample_linear(index), mpr.options.x == 1u);
  let gray = clamp((raw - mpr.window.x) / max(1e-6, mpr.window.y - mpr.window.x), 0.0, 1.0);
  return vec4<f32>(gray, gray, gray, 1.0);
}
