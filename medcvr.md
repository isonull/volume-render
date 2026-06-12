# From Medical Voxel Imaging to Cinematic Volume Rendering

本文汇总从医疗体素影像数据到 cinematic volume rendering (CVR) 的主要算法和工程步骤。目标场景包括 CT/CTA/MRI 等三维医学影像的高质量体渲染、术前规划、手术导航原型和可视化研究。

## 1. 输入数据与医学语义

常见输入模态：

- CT: 体素值通常为 HU，适合骨、钙化、肺、血管增强、器械等高对比结构。
- CTA/CCTA: 仍是 HU，但含碘造影剂，增强血池和血管腔会变亮；高 HU 不再只代表骨或钙化。
- MRI: 体素值不是 HU，强度依赖序列和扫描协议，需要归一化、偏置场校正和序列语义解释。
- CBCT: 常用于介入/术中场景，几何接近 CT，但噪声、伪影、HU 稳定性通常弱于诊断 CT。
- 3D ultrasound: 实时性强，但噪声、阴影、各向异性明显，体渲染前通常需要强预处理。

常见文件格式：

- DICOM: 临床原始序列常见格式，包含 spacing、orientation、patient/study metadata、窗宽窗位等。
- NIfTI / NRRD / MHD-MHA: 研究中常见的三维体数据格式。
- VDB / NanoVDB: 稀疏体数据格式，适合高质量体渲染和 GPU/离线渲染管线。

关键元数据：

- voxel spacing: 体素物理尺寸，决定渲染比例、采样步长和测量准确性。
- image orientation / affine: 决定病人坐标、左右前后上下方向和多模态配准。
- rescale slope/intercept: DICOM CT 转 HU 必需。
- window center/width: 临床显示窗，不等同于渲染 transfer function，但可作为初始参考。

## 2. 数据读取与体数据重建

基本步骤：

1. 读取 DICOM series 或 NIfTI volume。
2. 按 DICOM InstanceNumber、ImagePositionPatient 或 acquisition geometry 排序切片。
3. 使用 RescaleSlope / RescaleIntercept 将 CT 原始值转换为 HU。
4. 根据 PixelSpacing、SliceThickness、SpacingBetweenSlices 构建真实物理 spacing。
5. 根据 ImageOrientationPatient 和 ImagePositionPatient 构建 affine / world transform。
6. 检查缺片、重复片、非等间距切片、gantry tilt、不同 series 混入等问题。

常用库：

- ITK / SimpleITK: 医学图像读取、重采样、配准、滤波。
- GDCM / DCMTK: DICOM 解析。
- nibabel: NIfTI 读取。
- VTK: 医学可视化和体绘制。
- MONAI / nnU-Net: 医学深度学习预处理和分割。

## 3. 预处理

### 3.1 强度处理

CT / CTA：

- HU clipping: 例如按任务截断到 `[-1000, 3000]`、心血管局部可能用更窄范围。
- windowing: 骨窗、软组织窗、血管窗等用于交互显示或初始化 transfer function。
- normalization: 深度学习前常做 z-score、min-max 或固定 HU range scale。
- metal artifact reduction: 对支架、瓣膜、导丝、手术器械附近尤其重要。

MRI：

- bias field correction: 常用 N4 bias correction。
- intensity normalization: MRI 无绝对 HU，需要按序列和数据集规范化。
- denoising: 非局部均值、BM4D、深度学习去噪等。

CTA 特别注意：

- 造影剂使血池、冠脉、主动脉高亮。
- 钙化和增强血管腔都可能高 HU，单阈值容易混淆。
- 时间相位和心电门控会影响心腔、冠脉边界和运动伪影。

### 3.2 几何处理

- resampling: 重采样到各向同性 spacing，例如 `0.5-1.0 mm`，便于均匀采样和神经网络处理。
- cropping / ROI extraction: 提取心脏、主动脉、冠脉或目标器官区域，降低显存和计算量。
- registration: 多模态或术前术中融合时需要刚性、仿射或非刚性配准。
- motion correction: 心脏数据常涉及 ECG gating、多相位重建或运动校正。

### 3.3 噪声与伪影处理

常见算法：

- Gaussian / bilateral filter: 基础平滑，bilateral 可保边。
- anisotropic diffusion: 保边去噪。
- non-local means: 医学图像常用去噪。
- total variation denoising: 平滑噪声同时保留边界。
- deep denoising / artifact reduction: 对低剂量 CT、金属伪影、CBCT 更常见。

## 4. 分割与结构建模

CVR 可以直接渲染原始体数据，但医学场景通常需要分割来增强语义、遮挡管理和导航交互。

常见分割目标：

- 心脏: 左心房、左心室、右心房、右心室、心肌。
- 大血管: 主动脉、肺动脉、肺静脉、腔静脉。
- 冠脉: 冠状动脉树、中心线、管腔、钙化斑块。
- 手术相关结构: 瓣膜环、左心耳、房间隔、病灶、器械路径。

传统算法：

- thresholding: 基于 HU 的骨、血管增强、空气等粗分割。
- region growing: 从种子点扩展血管或器官。
- connected components: 去除孤立噪声。
- watershed / graph cut / random walker: 交互式分割常用。
- level set / active contour: 适合边界演化。
- vesselness filter: Frangi / Sato，用 Hessian 特征增强管状结构。
- centerline extraction: fast marching、minimal path、skeletonization。

深度学习算法：

- U-Net / 3D U-Net: 医学分割基础模型。
- nnU-Net: 强基线，自动配置预处理、网络和训练策略。
- V-Net、UNETR、SwinUNETR: 体数据分割常见模型。
- TotalSegmentator: 通用 CT 多结构分割，可作为初始 mask。

结构建模：

- marching cubes / flying edges: 从 mask 或等值面提取 mesh。
- surface smoothing: Laplacian、Taubin、windowed sinc。
- mesh decimation: 降面数便于实时导航。
- centerline + radius estimation: 用于血管导航、路径规划和管腔分析。
- signed distance field (SDF): 用于碰撞、切割、透明边界和神经渲染表示。

## 5. 体渲染核心算法

### 5.1 直接体渲染 DVR

直接体渲染不先提取表面，而是沿视线对体数据采样并合成颜色和透明度。

基本流程：

1. 为每个像素发射一条 ray。
2. 与 volume bounding box 求交。
3. 沿 ray 按步长采样体素值。
4. 用 transfer function 把标量值映射到颜色、透明度和材质参数。
5. 按 front-to-back 或 back-to-front alpha compositing 合成。
6. 当累计 opacity 足够高时 early termination。

常见合成公式：

- front-to-back alpha compositing
- emission-absorption model
- maximum intensity projection (MIP)
- minimum intensity projection (MinIP)
- average intensity projection
- iso-surface ray casting

### 5.2 Transfer Function

transfer function 是医学体渲染的关键，它决定哪些组织可见、颜色、透明度和材质感。

一维 TF：

- 输入: HU 或强度。
- 输出: RGB + opacity。
- 优点: 简单、快速、适合 CT。
- 缺点: CTA 中增强血池、骨、钙化可能 HU 重叠，难以区分。

二维/多维 TF：

- 输入: intensity + gradient magnitude、label、distance、vesselness、segmentation probability。
- 优点: 更好地区分边界、组织和血管。
- 缺点: 调参和 UI 更复杂。

医学常用思路：

- 骨: 高 HU，高 opacity，偏白或象牙色。
- 血管增强: 中高 HU，红/橙色，适当透明。
- 心肌/软组织: 中等 HU，低到中 opacity。
- 空气/背景: 透明。
- 分割 label: 使用独立颜色和透明度覆盖原始 HU。

### 5.3 梯度、法线与局部照明

为了让体数据有立体感，需要估计局部梯度作为法线：

- central difference gradient
- Sobel / Scharr gradient
- precomputed gradient volume
- gradient magnitude 用于边界增强和 TF 输入

局部光照模型：

- Phong / Blinn-Phong volume shading
- gradient-based diffuse/specular lighting
- opacity-weighted shading

传统 DVR 通常只有局部光照，缺少真实阴影和全局光照，因此不够 cinematic。

## 6. Cinematic Volume Rendering 的关键算法

CVR 的核心不是单一算法，而是一组让医学体数据产生照片级、电影感、真实空间感的渲染技术。

### 6.1 物理启发的体渲染模型

常见体渲染方程包含：

- absorption: 光在体内被吸收。
- out-scattering: 光被散射离开视线。
- in-scattering: 其他方向的光散射进入视线。
- emission: 发光体积，医学 CT 通常不是真实发光，但可用于风格化。

对 CT/CTA 来说，CVR 通常不是严格物理材料模拟，而是使用医学语义驱动的 transfer function，把 HU/label 映射为近似材质：骨、血管、软组织、器械等。

### 6.2 全局光照 Global Illumination

cinematic 效果的关键：

- soft shadows
- ambient occlusion
- multiple scattering approximation
- volumetric shadows
- indirect lighting
- environment lighting / image-based lighting

实现方式：

- path tracing: 质量最高，适合离线或高端 GPU。
- ray marching + shadow rays: 每个采样点向光源发 shadow ray。
- cone tracing / voxel cone tracing: 近似全局光照。
- precomputed lighting / light volume: 预计算光照降低实时成本。
- screen-space ambient occlusion: 快速但不完全体积正确。
- deep shadow maps / opacity shadow maps: 加速体积阴影。

### 6.3 Path Tracing Volume Rendering

体路径追踪可模拟体内散射、吸收和阴影。

核心技术：

- delta tracking / Woodcock tracking: 用 majorant 采样非均匀介质。
- ratio tracking / residual ratio tracking: 估计透射率。
- null-collision methods: 在复杂体密度中高效采样散射事件。
- multiple importance sampling: 平衡光源采样和相函数采样。
- phase function: 体散射方向分布，常用 Henyey-Greenstein。
- spectral rendering: 更真实但计算更重；医学 CT 通常可用 RGB 近似。

与 pbrt-v4 相关：

- pbrt-v4 的 VolPathIntegrator 使用 null-scattering 思路。
- `uniformgrid` / `rgbgrid` / `nanovdb` medium 可承载体数据。
- NanoVDB 适合稀疏体和高质量路径追踪管线。

### 6.4 材质与组织外观

CVR 常把医学组织映射为视觉材质：

- 骨: 高散射、高粗糙度、浅色、强遮挡。
- 血管/血池: 红色、半透明、较高吸收。
- 心肌/软组织: 暖色、低透明度、边界柔和。
- 钙化: 高亮、白色、较硬边界。
- 器械/金属: 高反射或单独 mesh 渲染。

常用增强：

- label-aware material: 分割标签决定材质，而不是只依赖 HU。
- edge enhancement: 梯度边界提高 opacity 或 specular。
- depth cueing: 远处降低饱和度或亮度。
- cutaway rendering: 剖切后保留内部结构。
- focus + depth of field: 强调导航目标。

## 7. 加速结构与数据表示

### 7.1 体数据加速

- empty space skipping: 跳过透明区域。
- early ray termination: opacity 接近 1 时停止。
- bricked volume: 将体数据分块，便于缓存、LOD 和跳空。
- octree / sparse voxel octree: 稀疏体加速。
- VDB / NanoVDB: 稀疏层级体数据结构。
- majorant grid: 为 delta tracking / null scattering 提供密度上界。
- min-max mipmap: 用于 MIP、跳空和自适应步长。

### 7.2 采样策略

- fixed-step ray marching: 简单稳定。
- adaptive step size: 空区域大步长，边界小步长。
- jittered sampling: 降低 banding。
- pre-integrated volume rendering: 大步长时减少 TF aliasing。
- temporal accumulation: 交互时逐帧累积降噪。

### 7.3 GPU 实现

常见后端：

- OpenGL / WebGL 3D texture ray marching
- Vulkan / DirectX compute shader
- CUDA / OptiX
- WebGPU
- VTK / ParaView / 3D Slicer
- pbrt / Mitsuba / custom path tracer

实时体绘制常用 3D texture + ray marching。高质量 cinematic 离线渲染更适合 OptiX/CUDA/path tracing 或 pbrt 类渲染器。

## 8. 从医学体素到 CVR 的推荐流水线

### 8.1 原型/研究级流水线

1. 读取 DICOM/NIfTI。
2. 转 HU 或做 MRI normalization。
3. 重采样到一致 spacing。
4. 裁剪心脏 ROI。
5. 去噪和伪影处理。
6. 分割关键结构，如心腔、血管、钙化、骨。
7. 设计 HU + label 混合 transfer function。
8. 用 DVR 快速预览。
9. 加入 gradient shading、ambient occlusion、soft shadow。
10. 对目标结构做 cinematic material mapping。
11. 如需高质量，导出为 NanoVDB 或渲染器支持的 volume grid。
12. 使用 path tracing / volumetric GI 渲染最终图像。

### 8.2 心脏 CTA/CCTA 推荐流程

1. DICOM series 读取，确认 ECG-gated phase。
2. 转 HU，保留 spacing 和 affine。
3. 血管窗预览，检查冠脉和心腔增强是否足够。
4. 分割或增强：
   - 心腔和大血管: threshold + region growing 或深度网络。
   - 冠脉: vesselness + centerline 或专用冠脉分割网络。
   - 钙化: 高 HU threshold + 位置/形态约束。
5. 建立 label-aware TF：
   - 增强血池/冠脉: 红色半透明。
   - 钙化: 白色高不透明。
   - 心肌: 暖色低透明。
   - 骨: 可隐藏或低透明，避免遮挡心脏。
6. 使用剖切、clipping plane、focus ROI 展示导航目标。
7. 需要 pbrt/CVR 离线效果时，将 density/label 转为 grid 或 NanoVDB。

### 8.3 pbrt/NanoVDB 方向

可行路径：

1. 医学数据读取与预处理在外部完成，例如 SimpleITK/Python/C++。
2. 将 HU 或分割后的密度场映射成 `density`。
3. 可选：将 label 或不同组织拆成多个 volume/medium。
4. 导出为 NanoVDB 或 pbrt `uniformgrid` 参数。
5. 在 pbrt 中使用 `nanovdb` medium 或 `uniformgrid` medium。
6. 设置吸收、散射、phase function、光源和相机。
7. 使用 VolPathIntegrator/path tracing 得到带全局光照的体渲染结果。

注意：pbrt 的体介质模型偏物理渲染，医学 HU 到 `sigma_a`、`sigma_s`、`density` 的映射需要自定义。它不是临床 DICOM viewer，需要外部医学语义处理。

## 9. 交互与手术导航相关步骤

手术导航与纯 cinematic 展示不同，要求空间准确性、低延迟和可解释性。

关键环节：

- patient-to-image registration: 病人坐标与影像坐标配准。
- instrument tracking: 光学、电磁或机器人位姿追踪。
- image-to-device calibration: 成像设备、相机、探头和导航坐标统一。
- real-time clipping / slicing: 显示器械前方、目标周围和风险结构。
- multi-modal fusion: 术前 CT/CTA + 术中超声/X-ray/CBCT。
- uncertainty visualization: 显示配准误差、分割置信度和禁区边界。

导航中 CVR 的定位：

- 适合术前规划、术中辅助理解、患者/团队沟通。
- 不应牺牲几何准确性换取视觉效果。
- 关键结构应可切换到更朴素、可测量的 MPR/mesh/label 显示。

## 10. 质量控制与验证

医学体渲染必须检查：

- HU 是否正确转换。
- spacing 和方向是否正确。
- 左右方向是否反了。
- 是否混入不同 series 或不同相位。
- 重采样是否改变小血管/薄壁结构。
- transfer function 是否误导性隐藏病灶或风险结构。
- 分割是否漏掉冠脉小分支、瓣膜钙化、左心耳边界等。
- 渲染中阴影、透明度和风格化是否造成临床误读。

评价指标：

- 分割: Dice、IoU、Hausdorff distance、surface distance。
- 血管: centerline overlap、branch detection、radius error。
- 配准: TRE、fiducial error、surface distance。
- 渲染: 交互帧率、采样噪声、边界清晰度、医生主观评分。

## 11. 常见技术选型

快速医学可视化：

- 3D Slicer
- VTK / ParaView
- ITK-SNAP

研究与深度学习：

- SimpleITK + MONAI + PyTorch
- nnU-Net
- nibabel / pydicom

实时渲染：

- VTK GPU volume ray casting
- OpenGL/Vulkan/WebGPU custom ray marching
- Unity/Unreal volume rendering plugin 或自研 shader

高质量 cinematic / path tracing：

- CUDA / OptiX custom renderer
- pbrt-v4 volume rendering
- NanoVDB/OpenVDB as sparse volume storage

## 12. 总结

从医疗体素数据到 CVR 的核心链路是：

`DICOM/NIfTI 读取 -> HU/强度校正 -> 几何重建 -> 去噪/重采样/裁剪 -> 分割与语义标注 -> transfer function -> DVR/ray marching -> 光照与阴影 -> 全局光照/path tracing -> 交互、配准和验证`

其中最关键的三件事是：

1. 医学数据语义正确：HU、spacing、方向、相位和模态不能错。
2. 组织映射正确：只靠 HU 不够，CTA/心脏导航通常需要 label、vesselness 或分割结果辅助。
3. 渲染目标明确：临床导航优先准确和实时，cinematic 展示优先光照、阴影、材质和空间感。
