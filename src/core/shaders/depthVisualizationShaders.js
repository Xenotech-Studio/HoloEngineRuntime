// 深度可视化 Shader

/**
 * 深度可视化顶点着色器
 * 用于渲染全屏 quad
 */
export const depthVisualizationVertexShader = `
  #version 300 es
  precision highp float;
  
  in vec2 position;
  out vec2 vUv;
  
  void main() {
    // 全屏 quad：位置直接作为 UV
    vUv = position * 0.5 + 0.5; // 从 [-1, 1] 映射到 [0, 1]
    gl_Position = vec4(position, 0.0, 1.0);
  }
`.trim();

/**
 * 深度可视化片段着色器
 * 读取深度纹理并映射为颜色
 */
export const depthVisualizationFragmentShader = `
  #version 300 es
  precision highp float;
  
  uniform sampler2D depthTexture;
  uniform float near;
  uniform float far;
  uniform float depthRange; // 深度范围（米），用于映射，例如 30.0 表示关注 10-30 米范围
  uniform float depthRangeNear; // 近处深度范围（米），用于调整颜色渐变的起始距离
  uniform float gamma; // Gamma 值，用于调整映射曲线的非线性程度（>1 时增强近处，<1 时增强远处）
  
  in vec2 vUv;
  out vec4 fragColor;
  
  // 将深度值从 NDC 空间转换为线性深度（世界空间距离）
  // 标准公式：linearDepth = (2.0 * near * far) / (far + near - depth * (far - near))
  float linearizeDepth(float depth, float near, float far) {
    return (2.0 * near * far) / (far + near - depth * (far - near));
  }
  
  // 使用平滑的对数映射来拉伸深度范围，让更大距离范围内的变化更明显
  float logarithmicDepthMapping(float linearDepth, float range, float rangeNear) {
    // 将对数映射应用到深度值
    // rangeNear 是近处深度范围，range 是远处深度范围
    // 实际映射范围是 [rangeNear, range]
    
    // 确保 range > rangeNear，避免除零错误
    if (range <= rangeNear) {
      // 如果范围无效，直接返回基于 linearDepth 的简单映射
      return min(linearDepth / range, 1.0);
    }
    
    // 如果深度小于 rangeNear，映射到 0
    if (linearDepth <= rangeNear) {
      return 0.0;
    }
    
    // 如果深度大于 range，映射到接近 1.0
    if (linearDepth >= range) {
      // 超出范围的部分平滑压缩
      float excess = (linearDepth - range) / (range * 2.0); // 继续压缩
      excess = min(excess, 1.0);
      return 0.95 + excess * 0.05; // 平滑过渡到接近 1.0
    }
    
    // 在范围内：将 [rangeNear, range] 映射到 [0, 1]
    float normalized = (linearDepth - rangeNear) / (range - rangeNear);
    
    // 使用平滑的对数映射来改善分布
    // 使用 log(1 + x * scale) / log(1 + scale) 来映射，这样 0->0, 1->1
    float scale = 2.0;
    float logMapped = log(1.0 + normalized * scale) / log(1.0 + scale);
    
    // 应用 gamma 校正来调整曲线的非线性程度
    // gamma > 1: 增强近处的变化（曲线更陡）
    // gamma < 1: 增强远处的变化（曲线更平缓）
    // gamma = 1: 线性映射
    if (gamma > 0.0 && gamma != 1.0) {
      logMapped = pow(logMapped, 1.0 / gamma);
    }
    
    return logMapped;
  }
  
  // 分段线性映射：在指定范围内使用线性映射，范围外压缩
  float piecewiseLinearMapping(float linearDepth, float range) {
    float normalized = linearDepth / range;
    if (normalized <= 1.0) {
      // 在范围内：线性映射
      return normalized;
    } else {
      // 超出范围：压缩到 0.9-1.0
      float excess = (normalized - 1.0) / (far / range - 1.0);
      return 0.9 + excess * 0.1;
    }
  }
  
  void main() {
    // 读取深度值（从深度纹理的 R 通道，NDC 空间）
    float ndcDepth = texture(depthTexture, vUv).r;
    
    // 如果没有深度值（背景），显示黑色
    if (ndcDepth >= 1.0) {
      fragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    
    // 将 NDC 深度转换为线性深度（世界空间距离）
    float linearDepth = linearizeDepth(ndcDepth, near, far);
    
    // 使用改进的映射来拉伸深度范围，让更大距离范围内的变化更明显
    // depthRange 指定关注的深度范围（米），例如 10.0 表示关注 0-10 米
    float mappedDepth;
    
    // 先检查参数有效性
    if (depthRange > 0.0 && far > near && linearDepth > 0.0 && depthRange > depthRangeNear) {
      // 使用对数映射，让指定范围内的深度变化更均匀
      mappedDepth = logarithmicDepthMapping(linearDepth, depthRange, depthRangeNear);
    } else {
      // 如果参数无效，使用改进的 NDC 深度映射
      // 使用平方根映射来拉伸近处的深度，让变化更明显
      mappedDepth = sqrt(ndcDepth);
    }
    
    // 确保 mappedDepth 在有效范围内
    mappedDepth = clamp(mappedDepth, 0.0, 1.0);
    
    // 灰度映射（近=白，远=黑）
    vec3 color = vec3(1.0 - mappedDepth);
    
    fragColor = vec4(color, 1.0);
  }
`.trim();

