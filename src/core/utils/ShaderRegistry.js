/**
 * Shader 注册表
 * 管理所有 shader 的注册、编译和查找
 */

import { createShader, createProgram } from './webgl';

export class ShaderRegistry {
  constructor(gl) {
    this.gl = gl;
    this.shaders = new Map(); // name -> { vertex, fragment, program, uniforms, attributes }
  }

  /**
   * 注册一个 shader
   * @param {string} name - Shader 名称
   * @param {string} vertexSource - 顶点着色器源码
   * @param {string} fragmentSource - 片段着色器源码
   * @param {Array<string>} uniformNames - Uniform 名称列表（可选，用于预获取 location）
   * @param {Array<string>} attributeNames - Attribute 名称列表（可选，用于预获取 location）
   * @returns {{ program: WebGLProgram, uniforms: Object, attributes: Object }}
   */
  register(name, vertexSource, fragmentSource, uniformNames = [], attributeNames = []) {
    if (this.shaders.has(name)) {
      console.warn(`[ShaderRegistry] Shader "${name}" 已存在，将覆盖`);
      this.unregister(name);
    }

    const gl = this.gl;
    
    // 编译 shader
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    
    // 创建 program
    const program = createProgram(gl, vertexShader, fragmentShader);
    
    // 获取 uniforms
    const uniforms = {};
    for (const uniformName of uniformNames) {
      const location = gl.getUniformLocation(program, uniformName);
      if (location !== null) {
        uniforms[uniformName] = location;
      }
    }
    
    // 获取 attributes
    const attributes = {};
    for (const attrName of attributeNames) {
      const location = gl.getAttribLocation(program, attrName);
      if (location >= 0) {
        attributes[attrName] = location;
      }
    }
    
    const shaderInfo = {
      name,
      vertexSource,
      fragmentSource,
      program,
      uniforms,
      attributes,
      vertexShader,
      fragmentShader,
    };
    
    this.shaders.set(name, shaderInfo);
    
    return shaderInfo;
  }

  /**
   * 获取已注册的 shader
   * @param {string} name - Shader 名称
   * @returns {{ program: WebGLProgram, uniforms: Object, attributes: Object }|null}
   */
  get(name) {
    return this.shaders.get(name) || null;
  }

  /**
   * 检查 shader 是否已注册
   * @param {string} name - Shader 名称
   * @returns {boolean}
   */
  has(name) {
    return this.shaders.has(name);
  }

  /**
   * 注销 shader（释放资源）
   * @param {string} name - Shader 名称
   */
  unregister(name) {
    const shaderInfo = this.shaders.get(name);
    if (shaderInfo) {
      const gl = this.gl;
      if (shaderInfo.program) gl.deleteProgram(shaderInfo.program);
      if (shaderInfo.vertexShader) gl.deleteShader(shaderInfo.vertexShader);
      if (shaderInfo.fragmentShader) gl.deleteShader(shaderInfo.fragmentShader);
      this.shaders.delete(name);
    }
  }

  /**
   * 清除所有 shader
   */
  clear() {
    for (const name of this.shaders.keys()) {
      this.unregister(name);
    }
  }

  /**
   * 获取所有已注册的 shader 名称
   * @returns {Array<string>}
   */
  list() {
    return Array.from(this.shaders.keys());
  }
}
