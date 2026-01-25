/**
 * 场景管理器 - 管理多个高斯点云对象（HoloEngineRuntime 内置）
 */

export class SplatObject {
  constructor(id, modelUrl, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], assetId = null, name = null, type = null) {
    this.id = id;
    this.modelUrl = modelUrl;
    this.assetId = assetId;
    this.name = name || id;
    this.type = type;
    this.position = position;
    this.rotation = rotation;
    this.scale = scale;
    this.texture = null;
    this.textureWidth = 0;
    this.textureHeight = 0;
    this.indexBuffer = null;
    this.vertexCount = 0;
    this.loaded = false;
    this.loading = false;
    this.shTexture = null;
    this.sphericalHarmonicsDegree = 0;
    this.worker = null;
  }

  getModelMatrix(createTransformMatrix) {
    const rotationRad = this.rotation.map(deg => (deg * Math.PI) / 180);
    return createTransformMatrix(this.position, rotationRad, this.scale);
  }
}

export class SceneManager {
  constructor() {
    this.objects = new Map();
    this.objectList = [];
  }

  addObject(id, modelUrl, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], assetId = null, name = null, type = null) {
    if (this.objects.has(id)) {
      console.warn(`[SceneManager] 对象 ${id} 已存在，将被替换`);
      const oldObj = this.objects.get(id);
      const index = this.objectList.indexOf(oldObj);
      if (index > -1) this.objectList.splice(index, 1);
      if (oldObj.worker) oldObj.worker.terminate();
    }
    const obj = new SplatObject(id, modelUrl, position, rotation, scale, assetId, name, type);
    this.objects.set(id, obj);
    this.objectList.push(obj);
    return obj;
  }

  getObject(id) {
    return this.objects.get(id);
  }

  getAllObjects() {
    return this.objectList;
  }

  removeObject(id) {
    const obj = this.objects.get(id);
    if (obj) {
      this.objects.delete(id);
      const index = this.objectList.indexOf(obj);
      if (index > -1) this.objectList.splice(index, 1);
      if (obj.worker) obj.worker.terminate();
    }
  }

  clearAll() {
    const allObjects = [...this.objectList];
    allObjects.forEach(obj => this.removeObject(obj.id));
  }

  updateObjectTransform(id, position, rotation, scale) {
    const obj = this.objects.get(id);
    if (obj) {
      if (position) obj.position = position;
      if (rotation) obj.rotation = rotation;
      if (scale) obj.scale = scale;
    }
  }

  moveObjectUp(id) {
    const index = this.objectList.findIndex(obj => obj.id === id);
    if (index === -1 || index === 0) return false;
    const obj = this.objectList[index];
    this.objectList[index] = this.objectList[index - 1];
    this.objectList[index - 1] = obj;
    return true;
  }

  moveObjectDown(id) {
    const index = this.objectList.findIndex(obj => obj.id === id);
    if (index === -1 || index === this.objectList.length - 1) return false;
    const obj = this.objectList[index];
    this.objectList[index] = this.objectList[index + 1];
    this.objectList[index + 1] = obj;
    return true;
  }

  dispose() {
    this.objectList.forEach(obj => {
      if (obj.worker) obj.worker.terminate();
    });
    this.objects.clear();
    this.objectList = [];
  }
}
