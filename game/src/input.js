// FREIGHTLINE input: keyboard state, pointer-lock mouse look, and the one
// shot button, gathered in one place. main.js polls this each frame; nothing
// else listens to the DOM for gameplay keys.

export function createInput(element, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    firing: false,
    aiming: false,
    locked: false,
    lookX: 0,
    lookY: 0,
  };

  element.addEventListener('click', () => {
    if (!state.locked) element.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === element;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
    }
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX || 0;
    state.lookY += event.movementY || 0;
  });
  document.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', (event) => {
    keys.add(event.code);
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  });

  return {
    state,
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    requestLock() {
      element.requestPointerLock();
    },
  };
}
