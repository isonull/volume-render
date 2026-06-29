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
@group(0) @binding(4) var densitySampler: sampler;
@group(0) @binding(5) var<storage, read> majorantVoxels: array<f32>;

struct Ray {
  origin: vec3<f32>,
  direction: vec3<f32>,
}

fn generate_camera_ray(uv: vec2<f32>) -> Ray {
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0);
  let nearH = camera.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farH = camera.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let nearP = nearH.xyz / nearH.w;
  let farP = farH.xyz / farH.w;
  let origin = camera.cameraPositionAndFrame.xyz;
  return Ray(origin, normalize(farP - origin + (farP - nearP) * 1e-6));
}

fn intersect_volume_bounds(ray: Ray) -> vec2<f32> {
  let boundsMin = vec3<f32>(-0.5);
  let boundsMax = vec3<f32>(0.5);
  let invDir = 1.0 / ray.direction;
  let t0 = (boundsMin - ray.origin) * invDir;
  let t1 = (boundsMax - ray.origin) * invDir;
  let tMin3 = min(t0, t1);
  let tMax3 = max(t0, t1);
  let tMin = max(max(tMin3.x, tMin3.y), tMin3.z);
  let tMax = min(min(tMax3.x, tMax3.y), tMax3.z);
  return vec2<f32>(max(tMin, 0.0), tMax);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = vec2<u32>(camera.viewportAndTime.xy);
  if (id.x >= size.x || id.y >= size.y) {
    return;
  }

  let index = id.x + size.x * id.y;
  let background = params.environmentL.xyz * 0.05;
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(size);
  let ray = generate_camera_ray(uv);
  let tHit = intersect_volume_bounds(ray);
  if (tHit.y <= tHit.x) {
    accumulation[index] += vec4<f32>(background, 1.0);
    return;
  }

  let sampleCount = 128u;
  let densityScale = max(params.misc.x, 0.01);
  let globalHint = max(majorantVoxels[0], 1e-4);
  let tint = normalize(params.sigmaS.xyz + vec3<f32>(0.45, 0.38, 0.28));
  let dt = (tHit.y - tHit.x) / f32(sampleCount);

  var color = vec3<f32>(0.0);
  var transmittance = 1.0;

  for (var i = 0u; i < 128u; i += 1u) {
    let stepT = (f32(i) + 0.5) / f32(sampleCount);
    let t = tHit.x + stepT * (tHit.y - tHit.x);
    let pVolume = ray.origin + ray.direction * t + vec3<f32>(0.5);
    let density = textureSampleLevel(densityTexture, densitySampler, pVolume, 0.0).r;
    let alpha = clamp(density * densityScale * dt * 1.5, 0.0, 0.18);
    let shade = 0.45 + 0.55 * pVolume.z;
    let sampleColor = tint * shade * (0.45 + density * 1.4 + globalHint * 0.05);
    color += transmittance * sampleColor * alpha;
    transmittance *= 1.0 - alpha;
    if (transmittance < 0.01) {
      break;
    }
  }

  accumulation[index] += vec4<f32>(color + background * transmittance, 1.0);
}
