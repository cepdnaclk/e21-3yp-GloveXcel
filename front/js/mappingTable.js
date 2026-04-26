export const FINGER_MAPPING_TABLE = [
  {
    fingerName: "Thumb",
    sensorIndex: 0,
    inputMin: 0,
    inputMax: 255,
    angleMin: 0,
    angleMax: 90,
    invert: true,
    baseRatio: 0.5,
    midRatio: 0.6,
    tipRatio: 1.0,
    isThumb: true,
    spreadAmount: 25,
    spreadInvert: true,
    curlAxis: [0, 0,-1],
    spreadAxis: [0, 1, 0],
    thumbMidAxis: [0, 0, -1],
    thumbTipAxis: [0, 0, -1],
    // Update these bone names to match your GLB skeleton.
    bones: {
      base: "Thumb_1_R",
      mid: "Thumb_2_R",
      tip: "Thumb_3_R"
    }
  },
  {
    fingerName: "Index",
    sensorIndex: 1,
    inputMin: 0,
    inputMax: 255,
    angleMin: 0,
    angleMax: 100,
    invert: true,
    baseRatio: 0.9,
    midRatio: 1.0,
    tipRatio: 0.8,
    isThumb: false,
    spreadAmount: 0,
    spreadInvert: false,
    curlAxis: [0, 0, -1],
    spreadAxis: [0, 1, 0],
    thumbMidAxis: [1, 0, 0],
    thumbTipAxis: [1, 0, 0],
    bones: {
      base: "Index_1_R",
      mid: "Index_2_R",
      tip: "Index_3_R"
    }
  },
  {
    fingerName: "Middle",
    sensorIndex: 2,
    inputMin: 0,
    inputMax: 255,
    angleMin: 0,
    angleMax: 100,
    invert: true,
    baseRatio: 0.9,
    midRatio: 1.0,
    tipRatio: 0.85,
    isThumb: false,
    spreadAmount: 0,
    spreadInvert: false,
    curlAxis: [0, 0, -1],
    spreadAxis: [0, 1, 0],
    thumbMidAxis: [1, 0, 0],
    thumbTipAxis: [1, 0, 0],
    bones: {
      base: "Middle_1_R",
      mid: "Middle_2_R",
      tip: "Middle_3_R"
    }
  },
  {
    fingerName: "Ring",
    sensorIndex: 3,
    inputMin: 0,
    inputMax: 255,
    angleMin: 0,
    angleMax: 105,
    invert: true,
    baseRatio: 0.85,
    midRatio: 1.0,
    tipRatio: 0.8,
    isThumb: false,
    spreadAmount: 0,
    spreadInvert: false,
    curlAxis: [0, 0, -1],
    spreadAxis: [0, 1, 0],
    thumbMidAxis: [1, 0, 0],
    thumbTipAxis: [1, 0, 0],
    bones: {
      base: "Ring_1_R",
      mid: "Ring_2_R",
      tip: "Ring_3_R"
    }
  },
  {
    fingerName: "Pinky",
    sensorIndex: 4,
    inputMin: 0,
    inputMax: 255,
    angleMin: 0,
    angleMax: 110,
    invert: true,
    baseRatio: 0.81,
    midRatio: 1.0,
    tipRatio: 0.81,
    isThumb: false,
    spreadAmount: 0,
    spreadInvert: false,
    curlAxis: [0, 0, -1],
    spreadAxis: [0, 1, 0],
    thumbMidAxis: [1, 0, 0],
    thumbTipAxis: [1, 0, 0],
    bones: {
      base: "Little_1_R",
      mid: "Little_2_R",
      tip: "Little_3_R"
    }
  }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) {
    return outMin;
  }
  const t = (value - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

export function mapRawToBaseAngle(rawValue, row) {
  const clampedRaw = clamp(rawValue, row.inputMin, row.inputMax);
  if (row.invert) {
    return mapRange(clampedRaw, row.inputMin, row.inputMax, row.angleMax, row.angleMin);
  }
  return mapRange(clampedRaw, row.inputMin, row.inputMax, row.angleMin, row.angleMax);
}

export function mapPacketToFingerPose(rawPacket, mappingTable = FINGER_MAPPING_TABLE) {
  return mappingTable.map((row) => {
    const rawValue = rawPacket[row.sensorIndex] ?? 0;
    const baseAngle = mapRawToBaseAngle(rawValue, row);
    const midAngle = baseAngle * row.midRatio;
    const tipAngle = baseAngle * row.tipRatio;
    const spreadSign = row.spreadInvert ? -1 : 1;

    return {
      fingerName: row.fingerName,
      rawValue,
      baseAngle,
      midAngle,
      tipAngle,
      spreadAngle: row.isThumb ? row.spreadAmount * spreadSign : 0
    };
  });
}
