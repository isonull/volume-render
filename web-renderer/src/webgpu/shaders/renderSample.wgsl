struct CameraUniform {
  invViewProj: mat4x4<f32>,
  cameraPositionAndFrame: vec4<f32>,
  viewportAndTime: vec4<f32>,
}

struct RenderParams {
  volumeDims: vec4<u32>,
  majorantDims: vec4<u32>,
  sigmaA: vec4<f32>,
  sigmaS: vec4<f32>,
  misc: vec4<f32>,
  environmentL: vec4<f32>,
}

@group(0) @binding(0) var<uniform> camera: CameraUniform;
@group(0) @binding(1) var<uniform> params: RenderParams;
@group(0) @binding(2) var<storage, read_write> accumulation: array<vec4<f32>>;
@group(0) @binding(3) var densityTexture: texture_3d<f32>;
@group(0) @binding(4) var<storage, read> majorantVoxels: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = vec2<u32>(camera.viewportAndTime.xy);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }

  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  let dims = params.volumeDims.xyz;
  let maxCoord = vec3<i32>(vec3<u32>(max(dims, vec3<u32>(1u))) - vec3<u32>(1u));
  let x = clamp(i32(floor(uv.x * f32(dims.x))), 0, maxCoord.x);
  let y = clamp(i32(floor((1.0 - uv.y) * f32(dims.y))), 0, maxCoord.y);
  let sampleCount = 128u;
  let densityScale = max(params.misc.x, 0.01);
  let globalHint = max(majorantVoxels[0], 1e-4);
  let tint = normalize(params.sigmaS.xyz + vec3<f32>(0.45, 0.38, 0.28));

  var color = vec3<f32>(0.0);
  var transmittance = 1.0;

  for (var i = 0u; i < 128u; i += 1u) {
    let zw = (f32(i) + 0.5) / f32(sampleCount);
    let z = clamp(i32(floor(zw * f32(dims.z))), 0, maxCoord.z);
    let density = textureLoad(densityTexture, vec3<i32>(x, y, z), 0).r;
    let alpha = clamp(density * densityScale * 0.035, 0.0, 0.12);
    let shade = 0.45 + 0.55 * zw;
    let sampleColor = tint * shade * (0.45 + density * 1.4 + globalHint * 0.05);
    color += transmittance * sampleColor * alpha;
    transmittance *= 1.0 - alpha;
  }

  let background = params.environmentL.xyz * 0.05;
  let index = id.x + size.x * id.y;
  accumulation[index] += vec4<f32>(color + background * transmittance, 1.0);
}
