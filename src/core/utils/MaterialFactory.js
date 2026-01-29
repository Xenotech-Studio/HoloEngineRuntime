/**
 * Material 工厂
 * 提供内置 Material 创建方法和自定义 Material 支持
 */

import { Material } from './Material';
import { meshUnlitVertexShaderSource, meshUnlitFragmentShaderSource } from '../../shaders/meshUnlitShaders';
import { meshLitVertexShaderSource, meshLitFragmentShaderSource } from '../../shaders/meshLitShaders';
import { meshTransparentVertexShaderSource, meshTransparentFragmentShaderSource } from '../../shaders/meshTransparentShaders';

// 内置 shader 的 uniform 和 attribute 名称
const MESH_UNIFORMS = [
  'projection',
  'view',
  'model',
  'color',
  'diffuseTexture',
  'useTexture',
  'lightDirection',
  'lightColor',
  'lightIntensity',
  'ambientIntensity',
  'debugMode',
  'cameraPosition',
  'backFaceColor',
  'backFaceOpacity',
  'showBackFace',
  'alpha',
];

const MESH_ATTRIBUTES = [
  'position',
  'normal',
  'uv',
];

export class MaterialFactory {
  /**
   * 初始化内置 shader（在 ShaderRegistry 中注册）
   * @param {ShaderRegistry} shaderRegistry - Shader 注册表
   */
  static initializeBuiltinShaders(shaderRegistry) {
    // 注册 Unlit shader
    if (!shaderRegistry.has('mesh-unlit')) {
      shaderRegistry.register(
        'mesh-unlit',
        meshUnlitVertexShaderSource,
        meshUnlitFragmentShaderSource,
        MESH_UNIFORMS,
        MESH_ATTRIBUTES
      );
    }

    // 注册 Lit shader
    if (!shaderRegistry.has('mesh-lit')) {
      shaderRegistry.register(
        'mesh-lit',
        meshLitVertexShaderSource,
        meshLitFragmentShaderSource,
        MESH_UNIFORMS,
        MESH_ATTRIBUTES
      );
    }

    // 注册 Transparent shader
    if (!shaderRegistry.has('mesh-transparent')) {
      shaderRegistry.register(
        'mesh-transparent',
        meshTransparentVertexShaderSource,
        meshTransparentFragmentShaderSource,
        MESH_UNIFORMS,
        MESH_ATTRIBUTES
      );
    }
  }

  /**
   * 创建 Unlit Material
   * @param {ShaderRegistry} shaderRegistry - Shader 注册表
   * @param {Object} options - Material 选项
   * @returns {Material}
   */
  static createUnlit(shaderRegistry, options = {}) {
    const shader = shaderRegistry.get('mesh-unlit');
    if (!shader) {
      throw new Error('mesh-unlit shader 未注册，请先调用 MaterialFactory.initializeBuiltinShaders()');
    }

    return new Material(
      'Unlit',
      shader.program,
      shader.uniforms,
      shader.attributes,
      {
        blendMode: options.transparent ? 'transparent' : 'opaque',
        cullMode: options.cullMode || 'back',
        depthWrite: options.depthWrite !== false,
        depthTest: options.depthTest !== false,
        alpha: options.alpha !== undefined ? options.alpha : 1.0,
        properties: options.properties || {},
      }
    );
  }

  /**
   * 创建 Lit Material
   * @param {ShaderRegistry} shaderRegistry - Shader 注册表
   * @param {Object} options - Material 选项
   * @returns {Material}
   */
  static createLit(shaderRegistry, options = {}) {
    const shader = shaderRegistry.get('mesh-lit');
    if (!shader) {
      throw new Error('mesh-lit shader 未注册，请先调用 MaterialFactory.initializeBuiltinShaders()');
    }

    return new Material(
      'Lit',
      shader.program,
      shader.uniforms,
      shader.attributes,
      {
        blendMode: options.transparent ? 'transparent' : 'opaque',
        cullMode: options.cullMode || 'back',
        depthWrite: options.depthWrite !== false,
        depthTest: options.depthTest !== false,
        alpha: options.alpha !== undefined ? options.alpha : 1.0,
        properties: options.properties || {},
      }
    );
  }

  /**
   * 创建 Transparent Material
   * @param {ShaderRegistry} shaderRegistry - Shader 注册表
   * @param {Object} options - Material 选项
   * @returns {Material}
   */
  static createTransparent(shaderRegistry, options = {}) {
    const shader = shaderRegistry.get('mesh-transparent');
    if (!shader) {
      throw new Error('mesh-transparent shader 未注册，请先调用 MaterialFactory.initializeBuiltinShaders()');
    }

    return new Material(
      'Transparent',
      shader.program,
      shader.uniforms,
      shader.attributes,
      {
        blendMode: 'transparent',
        cullMode: options.cullMode || 'none', // 透明物体通常不剔除
        depthWrite: false, // 透明物体通常不写入深度
        depthTest: options.depthTest !== false,
        alpha: options.alpha !== undefined ? options.alpha : 0.5,
        properties: options.properties || {},
      }
    );
  }

  /**
   * 创建自定义 Material
   * @param {ShaderRegistry} shaderRegistry - Shader 注册表
   * @param {string} name - Material 名称
   * @param {string} vertexSource - 顶点着色器源码
   * @param {string} fragmentSource - 片段着色器源码
   * @param {Array<string>} uniformNames - Uniform 名称列表
   * @param {Array<string>} attributeNames - Attribute 名称列表
   * @param {Object} options - Material 选项
   * @returns {Material}
   */
  static createCustom(shaderRegistry, name, vertexSource, fragmentSource, uniformNames = [], attributeNames = [], options = {}) {
    const shaderName = `custom-${name}`;
    let shader = shaderRegistry.get(shaderName);
    
    if (!shader) {
      shader = shaderRegistry.register(shaderName, vertexSource, fragmentSource, uniformNames, attributeNames);
    }

    return new Material(
      name,
      shader.program,
      shader.uniforms,
      shader.attributes,
      {
        blendMode: options.blendMode || 'opaque',
        cullMode: options.cullMode || 'back',
        depthWrite: options.depthWrite !== false,
        depthTest: options.depthTest !== false,
        alpha: options.alpha !== undefined ? options.alpha : 1.0,
        properties: options.properties || {},
      }
    );
  }
}
