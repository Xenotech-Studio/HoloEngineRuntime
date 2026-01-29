/**
 * Material 类
 * 包含 shader program、uniforms、attributes 和渲染状态
 */

export class Material {
  /**
   * @param {string} name - Material 名称
   * @param {WebGLProgram} program - Shader program
   * @param {Object} uniforms - Uniform locations 对象
   * @param {Object} attributes - Attribute locations 对象
   * @param {Object} options - 渲染选项
   * @param {string} options.blendMode - 混合模式：'opaque' | 'transparent' | 'additive'
   * @param {string} options.cullMode - 剔除模式：'none' | 'front' | 'back'
   * @param {boolean} options.depthWrite - 是否写入深度
   * @param {boolean} options.depthTest - 是否深度测试
   * @param {number} options.alpha - 透明度（0-1），用于 transparent 模式
   */
  constructor(name, program, uniforms, attributes, options = {}) {
    this.name = name;
    this.program = program;
    this.uniforms = uniforms;
    this.attributes = attributes;
    
    // 渲染状态
    this.blendMode = options.blendMode || 'opaque';
    this.cullMode = options.cullMode || 'back';
    this.depthWrite = options.depthWrite !== false;
    this.depthTest = options.depthTest !== false;
    this.alpha = options.alpha !== undefined ? options.alpha : 1.0;
    
    // 自定义属性（用于存储额外的 uniform 值）
    this.properties = options.properties || {};
  }

  /**
   * 设置属性值
   * @param {string} name - 属性名称
   * @param {*} value - 属性值
   */
  setProperty(name, value) {
    this.properties[name] = value;
  }

  /**
   * 获取属性值
   * @param {string} name - 属性名称
   * @returns {*}
   */
  getProperty(name) {
    return this.properties[name];
  }

  /**
   * 克隆 Material（用于创建实例）
   * @returns {Material}
   */
  clone() {
    return new Material(
      this.name,
      this.program,
      this.uniforms,
      this.attributes,
      {
        blendMode: this.blendMode,
        cullMode: this.cullMode,
        depthWrite: this.depthWrite,
        depthTest: this.depthTest,
        alpha: this.alpha,
        properties: { ...this.properties },
      }
    );
  }
}
