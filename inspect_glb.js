const fs = require('fs');
const buffer = fs.readFileSync('public/models/Meshy_AI_biped/Meshy_AI_Meshy_Merged_Animations.glb');
const magic = buffer.readUInt32LE(0);
if (magic === 0x46546C67) { // 'glTF'
    const jsonStrLen = buffer.readUInt32LE(12);
    const jsonStr = buffer.toString('utf8', 20, 20 + jsonStrLen);
    const gltf = JSON.parse(jsonStr);
    console.log("Animations:");
    if (gltf.animations) gltf.animations.forEach(a => console.log(a.name));
    console.log("\nNodes (possible bones):");
    if (gltf.nodes) gltf.nodes.forEach(n => { if (n.name && n.name.toLowerCase().includes('hand')) console.log(n.name) });
}
