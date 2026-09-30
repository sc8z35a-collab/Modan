// dev server for the lane-C nature viewer (ignores screenshot output so vite doesn't reload mid-render)
import base from '../../vite.config.js';
export default { ...base, root: process.cwd(), server: { ...base.server, port: 5174, watch: { ignored: ['**/.agents/**', '**/.hub/**', '**/dist/**'] } } };
