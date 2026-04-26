import * as THREE from "three";

function axisFromArray(axisArray) {
  const axis = new THREE.Vector3(axisArray[0], axisArray[1], axisArray[2]);
  if (axis.lengthSq() === 0) {
    return new THREE.Vector3(1, 0, 0);
  }
  axis.normalize();
  return axis;
}

function quaternionForAxisAngle(axisArray, angleDeg) {
  const axis = axisFromArray(axisArray);
  const q = new THREE.Quaternion();
  q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(angleDeg));
  return q;
}

export class HandRigController {
  constructor(handRoot, mappingTable) {
    this.handRoot = handRoot;
    this.mappingTable = mappingTable;
    this.bindings = this._buildBindings();
  }

  _buildBindings() {
    const bindings = [];

    for (const row of this.mappingTable) {
      const baseBone = this.handRoot.getObjectByName(row.bones.base);
      const midBone = this.handRoot.getObjectByName(row.bones.mid);
      const tipBone = this.handRoot.getObjectByName(row.bones.tip);

      if (!baseBone || !midBone || !tipBone) {
        console.warn("Missing bone mapping for finger:", row.fingerName, row.bones);
        continue;
      }

      bindings.push({
        row,
        baseBone,
        midBone,
        tipBone,
        baseStart: baseBone.quaternion.clone(),
        midStart: midBone.quaternion.clone(),
        tipStart: tipBone.quaternion.clone()
      });
    }

    return bindings;
  }

  applyFingerPose(poseArray) {
    for (const pose of poseArray) {
      const binding = this.bindings.find((item) => item.row.fingerName === pose.fingerName);
      if (!binding) {
        continue;
      }

      const { row, baseBone, midBone, tipBone, baseStart, midStart, tipStart } = binding;

      const baseCurlQ = quaternionForAxisAngle(row.curlAxis, -pose.baseAngle * row.baseRatio);

      if (row.isThumb) {
        const spreadQ = quaternionForAxisAngle(row.spreadAxis, pose.spreadAngle);
        const baseQ = baseStart.clone().multiply(spreadQ).multiply(baseCurlQ);
        baseBone.quaternion.copy(baseQ);

        const midQ = midStart
          .clone()
          .multiply(quaternionForAxisAngle(row.thumbMidAxis, -pose.midAngle));
        const tipQ = tipStart
          .clone()
          .multiply(quaternionForAxisAngle(row.thumbTipAxis, -pose.tipAngle));

        midBone.quaternion.copy(midQ);
        tipBone.quaternion.copy(tipQ);
      } else {
        const midCurlQ = quaternionForAxisAngle(row.curlAxis, -pose.midAngle);
        const tipCurlQ = quaternionForAxisAngle(row.curlAxis, -pose.tipAngle);

        baseBone.quaternion.copy(baseStart.clone().multiply(baseCurlQ));
        midBone.quaternion.copy(midStart.clone().multiply(midCurlQ));
        tipBone.quaternion.copy(tipStart.clone().multiply(tipCurlQ));
      }
    }
  }

  static listAllBoneNames(root) {
    const names = [];
    root.traverse((obj) => {
      if (obj.isBone) {
        names.push(obj.name);
      }
    });
    return names;
  }
}
