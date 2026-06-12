# NIfTI WebGPU Volume Path Tracing MVP

本文定义 `web-renderer` 第一版 MVP：在浏览器中加载 `.nii` / `.nii.gz` 体素数据，并用 WebGPU 实现一个最小版、定义上对齐 pbrt-v4 的 volume path tracing renderer。

第一版目标是最小闭环：

```text
NIfTI
-> scalar density grid
-> pbrt-style Medium / MajorantGrid definitions
-> WebGPU compute Li()
-> accumulation
-> tonemap
-> canvas
```

第一版不做完整 pbrt，也不导出 `.pbrt` 文件。算法过程可以简化，但所有核心数据定义必须尽量对应 pbrt-v4 的 `GridMedium`、`MajorantGrid`、`RayMajorantSegment`、`MediumProperties`、`SampleT_maj` 和 `VolPathIntegrator::Li`。

## 1. MVP 非目标

第一版不实现：

- DICOM series。
- NanoVDB。
- RGBGridMedium。
- 多组织 label material。
- mesh/surface BSDF。
- area light MIS。
- wavefront queue pipeline。
- denoiser。
- 临床导航、测量和配准。
- pbrt scene parser。

第一版只实现：

- 一个 dense scalar volume。
- 一个 pbrt `GridMedium` 等价 medium。
- 一个低分辨率 `MajorantGrid`。
- 一个相机 ray。
- 一个环境光或一个简化方向光。
- 一个 compute pass 中完成单条路径。
- progressive accumulation。
- tonemapping。

## 2. pbrt-v4 对齐定义

### 2.1 Float

第一版 WebGPU 中 `Float` 固定为 `f32`。

对应 pbrt-v4：

```cpp
using Float = float; // 默认 PBRT_FLOAT_AS_DOUBLE 关闭
```

### 2.2 Spectrum / SampledSpectrum

pbrt-v4 使用 spectral rendering。MVP 不实现 sampled wavelengths，先用 RGB `vec3f` 近似 `SampledSpectrum`。

约定：

```ts
type SpectrumRGB = [number, number, number];
```

WGSL：

```wgsl
type SampledSpectrum = vec3f;
```

这是实现简化，不改变 pbrt 概念关系：

```text
sigma_a: absorption coefficient
sigma_s: scattering coefficient
sigma_t = sigma_a + sigma_s
sigma_maj: majorant extinction coefficient
```

### 2.3 Ray

对齐 pbrt `Ray` 的最小字段：

```wgsl
struct Ray {
  o: vec3f,
  d: vec3f,
}
```

第一版不实现：

- time
- medium pointer
- ray differentials

因为 MVP 只有一个全局 medium，所有 camera rays 都认为处于该 volume 外部，进入 volume bounds 后采样 medium。

### 2.4 Bounds3f

对齐 pbrt `Bounds3f`：

```wgsl
struct Bounds3f {
  pMin: vec3f,
  pMax: vec3f,
}
```

MVP 中 volume bounds 固定为：

```text
pMin = (-0.5, -0.5, -0.5)
pMax = ( 0.5,  0.5,  0.5)
```

后续再根据 NIfTI spacing 调整真实比例。

### 2.5 MediumProperties

严格对应 pbrt-v4：

```cpp
struct MediumProperties {
    SampledSpectrum sigma_a, sigma_s;
    PhaseFunction phase;
    SampledSpectrum Le;
};
```

MVP 定义：

```wgsl
struct MediumProperties {
  sigma_a: vec3f,
  sigma_s: vec3f,
  Le: vec3f,
  g: f32,
}
```

其中：

- `sigma_a`: 吸收系数。
- `sigma_s`: 散射系数。
- `Le`: 体发光。第一版固定为 `vec3f(0)`。
- `g`: Henyey-Greenstein phase function 参数。

### 2.6 GridMedium

对齐 pbrt-v4 `GridMedium` 的核心语义：

```text
sigma_a(p) = density(p) * sigma_a_spec * scale
sigma_s(p) = density(p) * sigma_s_spec * scale
```

MVP 使用一个全局 medium：

```ts
interface GridMediumParams {
  bounds: Bounds3;
  sigmaA: [number, number, number];
  sigmaS: [number, number, number];
  scale: number;
  g: number;
}
```

NIfTI intensity 不直接等于 pbrt density。MVP 先定义：

```text
density = clamp((intensity - windowMin) / (windowMax - windowMin), 0, 1)
```

### 2.7 RayMajorantSegment

严格对应 pbrt-v4：

```cpp
struct RayMajorantSegment {
    Float tMin, tMax;
    SampledSpectrum sigma_maj;
};
```

MVP 定义：

```wgsl
struct RayMajorantSegment {
  tMin: f32,
  tMax: f32,
  sigma_maj: vec3f,
}
```

第一版为了简化 `SampleT_maj`，可以先使用 RGB 中的第 0 通道采样候选事件：

```text
sampling channel = sigma_maj.r
```

这与 pbrt-v4 代码中大量使用 `sigma_maj[0]` 进行事件采样的结构保持一致。

### 2.8 MajorantGrid

对齐 pbrt-v4 `MajorantGrid`：

```cpp
struct MajorantGrid {
    Bounds3f bounds;
    vector<Float> voxels;
    Point3i res;
};
```

MVP 定义：

```ts
interface MajorantGrid {
  bounds: Bounds3;
  res: [number, number, number];
  voxels: Float32Array;
}
```

每个 voxel 存标量最大 density：

```text
majorantDensity[cell] = max density in cell
```

在 shader 中计算：

```text
sigma_maj = majorantDensity[cell] * scale * (sigma_a + sigma_s)
```

MVP 推荐：

```text
majorantGrid.res = [16, 16, 16]
```

pbrt `GridMedium` 默认主要网格是 16³，`NanoVDBMedium` 使用 64³。第一版为减少工作量，采用 16³。

### 2.9 PhaseFunction

pbrt-v4 volume medium 使用 `HGPhaseFunction`：

```cpp
HenyeyGreenstein(cosTheta, g)
SampleHenyeyGreenstein(wo, g, u)
```

MVP 必须实现：

```wgsl
fn henyey_greenstein(cosTheta: f32, g: f32) -> f32
fn sample_henyey_greenstein(wo: vec3f, g: f32, u: vec2f) -> PhaseSample
```

第一版可以先固定：

```text
g = 0
```

这等价于各向同性散射，便于调试。

### 2.10 SampleT_maj

对应 pbrt-v4：

```cpp
SampleT_maj(ray, tMax, u, rng, lambda, callback)
```

MVP 定义：

```wgsl
fn sample_t_maj(ray: Ray, tMax: f32, rng: ptr<function, Rng>) -> MediumEvent
```

返回三类事件：

```text
Absorb
Scatter
Escape
```

内部仍按 pbrt 思路处理 null scattering：

```text
pAbsorb  = sigma_a[0] / sigma_maj[0]
pScatter = sigma_s[0] / sigma_maj[0]
pNull    = 1 - pAbsorb - pScatter
```

其中 `sigma_a/sigma_s` 来自 `sample_medium_properties(p)`。

### 2.11 VolPathIntegrator::Li

对应 pbrt-v4：

```cpp
SampledSpectrum VolPathIntegrator::Li(...)
```

MVP 定义：

```wgsl
fn Li(ray: Ray, rng: ptr<function, Rng>) -> vec3f
```

最小行为：

- camera ray 与 volume bounds 求交。
- 调用 `sample_t_maj`。
- scatter 时采样 phase function 继续路径。
- absorb 时终止。
- escape 时加环境光。
- 使用 `beta` 累积 path throughput。

第一版可以不实现 pbrt 的完整 MIS、`r_u/r_l`、surface interaction、BSSRDF、regularize。

## 3. 最小文件结构

第一版只新增这些文件：

```text
src/
  main.ts
  style.css
  io/
    niftiLoader.ts
  volume/
    volumeData.ts
    density.ts
    majorantGrid.ts
  webgpu/
    renderer.ts
    shaders/
      renderSample.wgsl
      tonemap.wgsl
```

不引入复杂 app framework。

## 4. 依赖

第一版只引入：

```bash
npm install nifti-reader-js fflate
```

不引入 three.js、VTK、React、UI 框架或 WebGPU wrapper。

## 5. 输入与预处理

### 5.1 NIfTI 读取

`niftiLoader.ts` 输出：

```ts
export interface NiftiVolume {
  dims: [number, number, number];
  spacing: [number, number, number];
  data: Float32Array;
  intensityMin: number;
  intensityMax: number;
}
```

必须处理：

- `.nii`
- `.nii.gz`
- header datatype 到 `Float32Array`
- `scl_slope`
- `scl_inter`

第一版可以忽略 affine orientation，只保留 spacing 信息展示。

### 5.2 Density 生成

`density.ts` 输出：

```ts
export interface DensityVolume {
  dims: [number, number, number];
  spacing: [number, number, number];
  density: Float32Array;
}
```

映射：

```text
density = clamp((value - windowMin) / (windowMax - windowMin), 0, 1)
```

第一版参数固定在 UI：

```text
windowMin
windowMax
scale
sigma_a RGB
sigma_s RGB
g
```

### 5.3 尺寸限制

第一版限制：

```text
maxDim = 128
```

若输入超过 `maxDim`，CPU 最近邻降采样。这样实现最小，后续再换 trilinear。

## 6. WebGPU 资源

### 6.1 densityTexture

```text
texture_3d<f32>
format: r8unorm 或 r16float
```

MVP 优先选择：

```text
r8unorm
```

原因是上传简单、显存小、足够验证算法。后续再升级为 `r16float`。

### 6.2 majorantGridBuffer

```text
storage buffer<f32>
length = majorantRes.x * majorantRes.y * majorantRes.z
```

存储 `majorantDensity`，shader 中再乘以 `scale * (sigma_a + sigma_s)`。

### 6.3 uniforms

最小 uniform：

```ts
interface CameraUniform {
  invViewProj: Float32Array; // mat4
  cameraPosition: [number, number, number];
  frameIndex: number;
}

interface RenderParams {
  volumeDims: [number, number, number];
  majorantDims: [number, number, number];
  sigmaA: [number, number, number];
  sigmaS: [number, number, number];
  scale: number;
  g: number;
  maxDepth: number;
  environmentL: [number, number, number];
}
```

### 6.4 accumulationBuffer

使用 storage buffer，避免 read-write storage texture 兼容问题：

```wgsl
struct PixelAccum {
  rgb: vec3f,
  sampleCount: f32,
}
```

## 7. 第一版渲染流程

每帧：

```text
if camera/volume/params changed:
  clear accumulation
  frameIndex = 0

renderSample.compute:
  one invocation per pixel
  generate camera ray
  Li(ray)
  accumulation[pixel] += vec4(L, 1)

tonemap.compute:
  color = accumulation.rgb / accumulation.sampleCount
  Reinhard + gamma
  write canvas texture
```

第一版只有两个 compute pass：

```text
renderSample
tonemap
```

## 8. 算法过程简述

### 8.1 renderSample

```text
pixel -> camera ray -> Li(ray) -> radiance -> accumulation
```

### 8.2 Li

```text
beta = 1
L = 0
for depth < maxDepth:
  intersect ray with volume bounds
  if miss:
    L += beta * environmentL
    break

  event = sample_t_maj(ray, tMax)
  if Absorb:
    break
  if Scatter:
    ray = scattered ray from event point
    beta *= phase weight
    continue
  if Escape:
    L += beta * environmentL
    break
```

第一版可以先不做 direct light，所以画面主要来自 environment / simplified in-scattering。若效果太暗，允许临时加入常量 single-scatter lighting，但命名仍保持为 `SampleLd` 的简化实现。

### 8.3 sample_t_maj

```text
walk majorant grid along ray
for each RayMajorantSegment:
  sample t with exponential distribution using sigma_maj[0]
  if t inside segment:
    mp = sample_medium_properties(p)
    choose Absorb / Scatter / Null
    Null continues
return Escape
```

第一版如果 DDA 太耗时，可先用全局 `RayMajorantSegment` 跑通：

```text
tMin = volume entry
tMax = volume exit
sigma_maj = global max density * scale * (sigma_a + sigma_s)
```

但类型仍命名为 `RayMajorantSegment`，后续替换为 DDA 不改外部接口。

## 9. 最小 UI

第一版 UI 只需要：

- File input。
- Canvas。
- Window min/max。
- Scale。
- Sigma A RGB。
- Sigma S RGB。
- g。
- maxDepth。
- Reset accumulation。
- Volume info。
- Current samples。

不做复杂面板和 preset。

## 10. 里程碑

### Milestone 1: WebGPU 空渲染

完成：

- WebGPU device/context。
- storage accumulation buffer。
- tonemap pass。
- canvas 显示颜色。

### Milestone 2: NIfTI 到 density

完成：

- 加载 `.nii` / `.nii.gz`。
- 输出 `DensityVolume`。
- maxDim 128 降采样。
- 显示 dims/min/max。

### Milestone 3: pbrt-style GridMedium MVP

完成：

- 上传 `densityTexture`。
- 建 `GridMediumParams`。
- 实现 `sample_medium_properties(p)`。

### Milestone 4: SampleT_maj MVP

完成：

- 全局 `RayMajorantSegment`。
- `sample_t_maj`。
- Absorb / Scatter / Null。
- `Li` 输出非黑结果。

### Milestone 5: MajorantGrid

完成：

- CPU 构建 16³ `MajorantGrid`。
- shader 用 DDA 或 cell stepping 读取局部 majorant。
- 替换全局 majorant。

## 11. 与 pbrt-v4 文件的对应关系

参考 pbrt-v4 文件：

```text
src/pbrt/media.h
  MediumProperties
  MajorantGrid
  RayMajorantSegment
  DDAMajorantIterator
  GridMedium
  SampleT_maj

src/pbrt/media.cpp
  GridMedium::Create
  GridMedium constructor builds majorantGrid

src/pbrt/cpu/integrators.h
  VolPathIntegrator

src/pbrt/cpu/integrators.cpp
  VolPathIntegrator::Li
  VolPathIntegrator::SampleLd
```

MVP 对应：

```text
pbrt GridMedium
-> DensityVolume + GridMediumParams

pbrt MajorantGrid
-> majorantGridBuffer

pbrt RayMajorantSegment
-> WGSL RayMajorantSegment

pbrt Medium::SamplePoint
-> sample_medium_properties

pbrt SampleT_maj
-> sample_t_maj

pbrt VolPathIntegrator::Li
-> Li

pbrt Film
-> accumulationBuffer + tonemap
```

## 12. 成功标准

第一版 MVP 成功标准：

- 浏览器可以加载一份 `.nii` 或 `.nii.gz`。
- 能生成 density volume。
- WebGPU 能根据 pbrt-style `GridMedium` 定义采样体介质。
- `sample_t_maj` 能产生 absorb / scatter / null 事件。
- accumulation 逐帧增加 sample count。
- canvas 输出非黑、可调参数影响明显的体渲染图像。

画面质量不作为第一版成功标准。第一版只验证定义和管线闭环。

