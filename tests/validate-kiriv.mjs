import { readFileSync } from 'node:fs';
import { parseKiriV } from '../src/utils/kiriv.js';
const texture = parseKiriV(readFileSync(process.argv[2]));
console.log(JSON.stringify({ validated: true, gaussian_count: texture.gaussianCount, representation: texture.representation, layout: texture.kirivHeader.payload_layout, runtime_bytes: texture.buffer.byteLength }));
