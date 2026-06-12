# Volume Rendering Notes

This document summarizes the rendering pipeline for medical voxel data, with
cinematic volume rendering as the target reference. It also covers the role of
BVH acceleration structures and possible GPU backends such as OptiX, Vulkan,
and WebGPU.

## 1. Medical Volume Data

Medical volume data is usually voxel data: a 3D grid where each sample stores a
scalar value.

Common sources:

- CT
- MRI
- PET
- CBCT
- Ultrasound volume

Common file formats:

- DICOM series: common clinical format, usually one file per slice
- NIfTI: `.nii`, `.nii.gz`
- NRRD: `.nrrd`
- MetaImage: `.mhd` plus `.raw`
- Raw binary volume
- HDF5 / Zarr for research or large datasets

For CT, voxel values are usually Hounsfield Units, or HU:

```text
air          about -1000 HU
fat          about -100 HU
water        about 0 HU
soft tissue  about 20 to 80 HU
bone         about 300 HU and above
metal        very high HU
```

A CT volume can be thought of as:

```text
volume[x, y, z] = HU value
```

Important metadata:

- voxel spacing
- slice thickness
- image orientation
- image position
- patient coordinate system
- rescale slope and intercept
- window center and width
- modality

Medical voxels are often anisotropic:

```text
x spacing = 0.6 mm
y spacing = 0.6 mm
z spacing = 1.5 mm
```

The renderer must account for this spacing, otherwise anatomy will be distorted.

## 2. Why Voxel Data Can Show Smooth Surfaces

The renderer usually does not draw each voxel as a cube. Instead, it treats the
volume as a continuous scalar field reconstructed from discrete samples.

At an arbitrary point `p`, the volume value is evaluated by interpolation:

```text
f(p) = trilinear_interpolate(volume, p)
```

The visible boundary of a vessel or bone is often not a mesh surface. It is an
optical boundary created by a transfer function:

```text
HU value -> color + opacity
```

When opacity rises sharply around a HU range, the viewer sees a surface-like
boundary. Smoothness comes from:

- trilinear or cubic interpolation
- high enough ray-marching sample rate
- gradient-based normals
- transfer-function ramps
- denoising and antialiasing

Gradient-based shading gives the boundary a surface normal:

```text
normal = normalize(gradient(f))
```

This enables diffuse lighting, highlights, shadows, and curvature cues.

Sometimes the surface really is a mesh. A common path is:

```text
voxel volume
  -> segmentation or thresholding
  -> marching cubes
  -> triangle mesh
  -> smoothing
  -> surface rendering
```

## 3. Traditional Direct Volume Rendering

Traditional direct volume rendering, or DVR, usually performs camera ray
marching.

Pipeline:

```text
camera ray
  -> intersect volume bounds
  -> march through volume
  -> sample scalar value
  -> apply transfer function
  -> front-to-back composite color and opacity
```

Simplified pseudocode:

```text
T = 1
C = 0

for t from tEnter to tExit:
    p = ray(t)
    s = sample(volume, p)
    rgba = transferFunction(s)
    alpha = convertOpacity(rgba.a, stepSize)

    C += T * alpha * rgba.rgb
    T *= 1 - alpha

    if T < threshold:
        break
```

This is fast and stable, but the lighting is usually local. Shadows, indirect
light, and multiple scattering are limited or approximated.

## 4. Cinematic Volume Rendering

Cinematic volume rendering treats voxel data as a participating medium rather
than only a colored transparent field.

Instead of only:

```text
scalar -> color + opacity
```

it tries to map data to optical properties:

```text
scalar / label / mask / gradient
  -> absorption coefficient sigma_a
  -> scattering coefficient sigma_s
  -> extinction coefficient sigma_t = sigma_a + sigma_s
  -> emission
  -> albedo
  -> phase function
```

This allows Monte Carlo path tracing to simulate:

- absorption
- scattering
- soft shadows
- global illumination
- translucency
- environment lighting
- multiple light paths

High-level pipeline:

```text
DICOM / NIfTI
  -> decode slices
  -> reconstruct HU or intensity volume
  -> spacing and orientation correction
  -> denoise / resample / crop
  -> optional segmentation
  -> transfer function / optical material mapping
  -> acceleration structure
  -> camera ray generation
  -> volume bounds intersection
  -> medium sampling
  -> direct lighting with transmittance shadows
  -> multiple scattering / path tracing
  -> denoising / temporal accumulation
  -> tone mapping / display
```

## 5. Medium Sampling

Two common approaches are fixed-step ray marching and stochastic medium
sampling.

### Fixed-Step Ray Marching

This is straightforward:

```text
for each step:
    p = ray(t)
    sigma_t = evaluateExtinction(p)
    accumulate optical depth
    composite or scatter
```

It is easy to implement and good for interactive previews, but it can be
expensive if the step size must be very small.

### Delta Tracking / Null Collision

Modern volumetric path tracers often use delta tracking. The idea is to use a
majorant `sigma_maj` such that:

```text
sigma_maj >= sigma_t(p)
```

Then sample candidate collision distances:

```text
t += -log(1 - random()) / sigma_maj
```

At the sampled point:

```text
accept probability = sigma_t(p) / sigma_maj
```

If accepted, it is a real medium interaction. If rejected, it is a null
collision and tracing continues.

For medical data, a good majorant grid is usually brick-based:

```text
brick.majorant = max sigma_t inside brick
```

This avoids using a single overly conservative value for the entire volume.

## 6. Lighting in Cinematic Volume Rendering

At a medium interaction point `p`, the renderer estimates incoming light:

```text
camera -> p -> light
```

For direct lighting:

```text
sample light direction
trace shadow ray through volume
evaluate transmittance
accumulate contribution
```

Volume shadow transmittance:

```text
T(a, b) = exp(-integral sigma_t ds)
```

For environment lighting, the renderer samples directions from an HDR
environment map and traces transmittance through the volume.

Multiple scattering extends paths:

```text
camera -> p1 -> p2 -> p3 -> light/environment
```

This is expensive but produces the soft, spatially rich look associated with
cinematic rendering.

## 7. Transfer Function Design

Transfer functions are central to medical volume rendering.

For CT:

```text
HU + gradient + segmentation mask -> optical material
```

Example mapping:

```text
air:
    sigma_t = 0

soft tissue:
    low to medium opacity
    warm translucent color

contrast-enhanced vessel:
    medium to high opacity
    red or orange color

bone:
    high opacity
    ivory color

metal:
    clamped or special handling
```

In a cinematic renderer, transfer functions should ideally produce optical
coefficients rather than only RGBA:

```text
HU -> sigma_a, sigma_s, albedo, phase parameters
```

## 8. Acceleration for Volume Rendering

Dense voxel volumes often use volume-specific acceleration instead of a triangle
BVH.

Useful structures:

- volume bounding box
- macro-cell grid
- min/max brick hierarchy
- occupancy mask
- majorant grid
- mip levels
- brick cache
- out-of-core paging

Example empty-space skipping:

```text
if transferFunction.opacityRange(brick.minValue, brick.maxValue) == 0:
    skip brick
```

Example majorant usage:

```text
ray enters brick
sigma_maj = brick.majorant
delta track inside this interval
```

## 9. BVH Main Function

BVH means Bounding Volume Hierarchy. Its main purpose is to accelerate spatial
queries, especially ray intersection.

Without a BVH:

```text
for every triangle:
    test ray-triangle intersection
```

With a BVH:

```text
test ray against root bounding box
skip entire subtrees when the ray misses a box
test primitives only in likely leaf nodes
```

Main BVH query types:

- closest-hit query
- any-hit / shadow query
- random-hit query for subsurface scattering
- custom primitive intersection via AABB plus intersection shader

Modern GPU ray tracing APIs usually use a two-level hierarchy:

```text
BLAS: bottom-level acceleration structure for mesh primitives
TLAS: top-level acceleration structure for instances and transforms
```

For pure voxel ray marching, BVH is not always necessary. For hybrid scenes with
meshes, segmentation surfaces, tools, implants, or procedural objects, BVH or RT
acceleration becomes important.

## 10. OptiX, Vulkan, and WebGPU

### OptiX

OptiX provides NVIDIA-specific GPU ray tracing:

```text
OptiX traversable
OptiX GAS / IAS
optixTrace()
shader binding table
raygen / closest-hit / any-hit / miss / intersection programs
```

pbrt-v4 uses CUDA plus OptiX:

```text
CUDA unified memory
wavefront queues
CUDA kernels for path state and shading
OptiX for BVH traversal and ray intersections
```

### Vulkan Ray Tracing

Vulkan can replace much of OptiX's BVH and ray intersection functionality.

Key extensions:

```text
VK_KHR_acceleration_structure
VK_KHR_ray_tracing_pipeline
VK_KHR_ray_query
```

Conceptual mapping:

```text
OptiX traversable      -> VkAccelerationStructureKHR
OptiX GAS / IAS        -> Vulkan BLAS / TLAS
optixTrace()           -> traceRayEXT or rayQueryEXT
closest-hit program    -> closest-hit shader
any-hit program        -> any-hit shader
intersection program   -> intersection shader
SBT                    -> Vulkan shader binding table
```

Vulkan is the best cross-vendor native option for replacing OptiX-like hardware
ray tracing, but it is lower-level and requires explicit memory management,
synchronization, descriptor management, and SPIR-V shader pipelines.

### WebGPU

WebGPU currently does not expose standard hardware ray tracing acceleration
structures or `traceRay`-style APIs.

It can still implement software ray tracing:

```text
WGSL compute shader
  -> custom BVH nodes in storage buffers
  -> manual ray-box traversal
  -> manual ray-triangle intersection
```

This is viable for teaching, browser demos, simple path tracers, and volume
ray marching. It is not equivalent to OptiX or Vulkan RT for hardware BVH
traversal.

For browser-based medical volume rendering, WebGPU compute is still useful:

```text
ray-box intersection
ray marching
3D texture sampling
transfer function
empty-space skipping
progressive rendering
```

## 11. Possible Implementation Roadmap

### Stage 1: Direct Volume Renderer

- Load raw volume or NIfTI/NRRD
- Support spacing and orientation
- Implement transfer function
- Implement ray-box intersection
- Implement front-to-back ray marching
- Add gradient shading
- Add early termination

### Stage 2: Medical Data Support

- Load DICOM series
- Convert CT raw values to HU
- Handle voxel spacing correctly
- Add window/level controls
- Add presets for bone, vessel, soft tissue, lung
- Add crop planes and ROI

### Stage 3: Acceleration

- Add brick min/max
- Add empty-space skipping
- Add majorant grid
- Add adaptive step size
- Add out-of-core brick streaming if needed

### Stage 4: Cinematic Rendering

- Map transfer function to optical coefficients
- Add direct light sampling
- Add transmittance shadow rays
- Add environment lighting
- Add delta tracking
- Add single scattering
- Add limited multiple scattering
- Add denoising and temporal accumulation

### Stage 5: Hybrid Geometry

- Add segmentation mesh support
- Add BVH or Vulkan RT backend
- Add mesh-volume compositing
- Add surgical tools / implants / markers

## 12. Summary

Traditional volume rendering treats voxel data as a colored transparent field.
Cinematic volume rendering treats it as an optical participating medium.

The key shift is:

```text
voxel scalar -> RGBA
```

to:

```text
voxel scalar -> absorption + scattering + transmittance + lighting
```

For a native high-performance renderer, Vulkan RT can replace much of OptiX's
BVH and ray intersection role. For browser-based work, WebGPU is excellent for
compute-based ray marching but currently requires software BVH traversal if
ray tracing is needed.
