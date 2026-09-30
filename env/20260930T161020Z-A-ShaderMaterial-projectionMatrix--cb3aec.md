# ShaderMaterial: projectionMatrix undeclared in fragment shader
_reported by A, 2026-09-30T16:10:20Z_

- **Symptom**: THREE.WebGLProgram: Shader Error ... 'projectionMatrix' : undeclared identifier -> lake not rendered; vite build and unit tests were green
- **Cause**: three.js only injects projectionMatrix/modelViewMatrix into the VERTEX prefix of ShaderMaterial; fragment gets viewMatrix/cameraPosition only. Build-time tools never compile GLSL
- **Fix / workaround**: pass it through a varying. And ALWAYS run one external-browser capture (PlaywrightConsoleCapture) after touching GLSL: shader compile errors only show up as console errors at runtime
