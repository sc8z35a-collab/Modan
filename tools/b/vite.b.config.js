// dev server for the lane-B prop viewer (ignores screenshot output so vite doesn't reload the page mid-render)
import base from '../../vite.config.js';
export default { ...base, root: process.cwd(), server: { ...base.server, watch: { ignored: ['**/.agents/**', '**/.hub/**', '**/dist/**'] } } };
