// ============================================================================
// HUD 3D
// ============================================================================
// Loads the HUD model (GLB) with three.js and turns every screen in it into a
// regular 2D canvas the rest of the game can draw on.
//
// Needs three-bundle.js loaded first (it provides the global THREE).
//
//   const hud3d = await initHud3D(document.getElementById('hud3d'));
//   const life = hud3d.screen('LivesScreen');     // { canvas, ctx, width, height, ... }
//   life.ctx.fillText('3', 10, 40);
//   life.markDirty();                             // upload it on the next render()
//   hud3d.render();                               // once per frame, from the game loop

// ============================================================================
// HUD 3D CONSTANTS
// ============================================================================

const HUD3D_MODEL_URL = 'Assets/Models/HUD.glb';
const HUD3D_BG_COLOR = 0x003049;                 // Same as the window backgroundColor in main.js
const HUD3D_PIXEL_RATIO_CAP = 1.5;               // Never render sharper than this on hi-dpi monitors (cheaper!)

// Screens are found by the name of their MATERIAL in Blender
const HUD3D_SCREEN_MATERIALS = [
    'MainScreen', 'ModeScreen', 'JunkScreen', 'LowFuelScreen', 'DialScreen',
    'LivesScreen', 'MoonbeamScreen', 'StardustScreen', 'PowerupMarqueeScreen',
    'ConservatoryScreen', 'RadioFace'
];

// Canvas sizing: small screens use a pixel density, the game window has a fixed width
const HUD3D_SCREEN_DENSITY = 512;                // Canvas pixels per world unit (about 1:1 at 1080p)
const HUD3D_SMALL_SCREEN_SCALE = 2;              // Oversample small screens so text stays crisp on big monitors
const HUD3D_SCREENS = {
    MainScreen: { width: 1600, live: true }      // The game window. Live = re-uploaded every frame
};

// Screens ignore the model's UVs by default: each one is projected straight down onto its own bounding box.
// That makes rotated, flipped, tiny, or missing UV islands harmless. Set false to use the UVs from Blender
const HUD3D_PLANAR_UVS = true;

// Nodes that start hidden
const HUD3D_HIDDEN_NODES = ['RightScreen', 'Play']; // Conservatory screen waits until that part of the game exists. Play swaps in for Pause later

// Light rig (the GLB has no lights). Tweak to taste
const HUD3D_LIGHTS = {
    hemiSky: 0xffffff,
    hemiGround: 0x6a7a8a,
    hemiIntensity: 1.6,
    sunColor: 0xffffff,
    sunIntensity: 2.2,
    sunOffset: [-1.5, 5, -1.5]                   // From the middle of the HUD: left, up, and toward the top of the screen
};

// Used only if the GLB comes without its camera
const HUD3D_FALLBACK_CAMERA = { fov: 22.9, aspect: 16 / 9, position: [2.417, 5.319, -3.359] };

// ============================================================================
// LOADING HELPERS
// ============================================================================

// XHR instead of fetch: it works from file:// inside Electron and over http
function hud3dLoadBinary(url) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => {
            const ok = xhr.status === 200 || (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0);
            if (ok) resolve(xhr.response);
            else reject(new Error('Could not load ' + url + ' (status ' + xhr.status + ')'));
        };
        xhr.onerror = () => reject(new Error('Could not load ' + url));
        xhr.send();
    });
}

// ============================================================================
// SCREEN MEASUREMENT
// ============================================================================

// Works out two things for a screen mesh:
//  - uvRect: the rectangle its UVs occupy (so the canvas can be mapped onto exactly that)
//  - size3D: how big that rectangle is in the real world (so the canvas gets the right shape)
function measureScreen(mesh) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    if (!uv) return null;

    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld.elements;

    // UV bounds
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
    }

    // World position of a vertex
    const world = (i) => {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        return [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14]
        ];
    };

    // World distance covered by one unit of U and one unit of V, averaged over the triangles
    const index = geo.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    let sumU = 0, sumV = 0, sumW = 0;

    for (let t = 0; t < triCount; t++) {
        const ia = index ? index.getX(t * 3) : t * 3;
        const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
        const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;

        const pa = world(ia), pb = world(ib), pc = world(ic);
        const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];

        const a = uv.getX(ib) - uv.getX(ia), c = uv.getY(ib) - uv.getY(ia);
        const b = uv.getX(ic) - uv.getX(ia), d = uv.getY(ic) - uv.getY(ia);
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-12) continue;

        // dP/dU and dP/dV
        const du = [0, 1, 2].map(k => (e1[k] * d - e2[k] * c) / det);
        const dv = [0, 1, 2].map(k => (e2[k] * a - e1[k] * b) / det);

        // Weight by triangle area so big triangles count more than slivers
        const cx = e1[1] * e2[2] - e1[2] * e2[1];
        const cy = e1[2] * e2[0] - e1[0] * e2[2];
        const cz = e1[0] * e2[1] - e1[1] * e2[0];
        const w = Math.sqrt(cx * cx + cy * cy + cz * cz);

        sumU += Math.hypot(du[0], du[1], du[2]) * w;
        sumV += Math.hypot(dv[0], dv[1], dv[2]) * w;
        sumW += w;
    }
    if (sumW === 0) return null;

    return {
        uvRect: { u0: u0, u1: u1, v0: v0, v1: v1 },
        size3D: { w: (u1 - u0) * (sumU / sumW), h: (v1 - v0) * (sumV / sumW) }
    };
}

// Replaces a screen mesh's UVs with a straight top-down projection onto its own bounding box,
// so the canvas always lands upright and the right way around. Same return shape as measureScreen
function planarizeScreen(mesh) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    mesh.updateWorldMatrix(true, false);
    const m = mesh.matrixWorld.elements;

    const wx = new Float32Array(pos.count);
    const wz = new Float32Array(pos.count);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        wx[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        wz[i] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (wx[i] < x0) x0 = wx[i];
        if (wx[i] > x1) x1 = wx[i];
        if (wz[i] < z0) z0 = wz[i];
        if (wz[i] > z1) z1 = wz[i];
    }
    const w = x1 - x0, h = z1 - z0;
    if (w <= 0 || h <= 0) return null;

    // u runs left to right, v runs top to bottom (the way a canvas does)
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (wx[i] - x0) / w;
        uv[i * 2 + 1] = (wz[i] - z0) / h;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    return { uvRect: { u0: 0, u1: 1, v0: 0, v1: 1 }, size3D: { w: w, h: h } };
}

// ============================================================================
// SCREEN
// ============================================================================

class Hud3DScreen {
    constructor(name, mesh, metrics, width, height, live, headless) {
        this.name = name;
        this.mesh = mesh;
        this.uvRect = metrics.uvRect;
        this.size3D = metrics.size3D;
        this.width = width;
        this.height = height;
        this.live = live;               // Live screens are uploaded every frame
        this.dirty = true;              // Everything else only when marked dirty
        this.canvas = null;
        this.ctx = null;
        this.texture = null;

        if (headless) return;

        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;
        this.ctx = this.canvas.getContext('2d');
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, width, height);

        // Map the canvas onto the screen's UV rectangle (whatever shape it was unwrapped as)
        const du = this.uvRect.u1 - this.uvRect.u0;
        const dv = this.uvRect.v1 - this.uvRect.v0;
        const texture = new THREE.CanvasTexture(this.canvas);
        texture.flipY = false;                          // glTF UVs start at the top left, like a canvas
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false;                // No mipmaps: cheaper to upload, and screens never shrink much
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.repeat.set(1 / du, 1 / dv);
        texture.offset.set(-this.uvRect.u0 / du, -this.uvRect.v0 / dv);
        this.texture = texture;

        // Screens glow: unlit, so the canvas colors show exactly as drawn (and it's cheaper to shade)
        const material = new THREE.MeshBasicMaterial({ map: texture });
        material.name = name;
        material.toneMapped = false;
        if (mesh.material && mesh.material.dispose) mesh.material.dispose();
        mesh.material = material;
    }

    // Call after drawing on a non-live screen so the next render() uploads it
    markDirty() {
        this.dirty = true;
    }
}

// ============================================================================
// HUD 3D
// ============================================================================

class Hud3D {
    constructor(canvas, options) {
        this.canvas = canvas;                           // The visible <canvas> three.js renders into
        this.options = Object.assign({ modelUrl: HUD3D_MODEL_URL, fit: 'contain', antialias: true, headless: false }, options);
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        this.designAspect = 16 / 9;                     // The aspect ratio the HUD was framed for
        this.baseFov = 22.9;                            // ...and the vertical field of view that goes with it
        this.screens = {};                              // Material name -> Hud3DScreen
        this.nodes = {};                                // Top-level node name -> Object3D
        this.pickables = [];                            // The only meshes the raycaster bothers with
        this.fit = this.options.fit;                    // 'contain' shows the whole HUD, 'cover' fills the window
        this.motion = null;                             // Set to a Hud3DMotion (hud3d_motion.js) to animate loadout changes
        this._lastTime = 0;
        this._ray = null;
        this._ndc = null;
    }

    // Loads the GLB and sets everything up. Resolves with this
    load() {
        return hud3dLoadBinary(this.options.modelUrl).then(buffer => this.loadFromBuffer(buffer));
    }

    loadFromBuffer(buffer) {
        // Say what is wrong instead of letting the parser throw something cryptic
        const magic = String.fromCharCode.apply(null, new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)));
        if (buffer.byteLength < 12 || magic !== 'glTF') {
            const peek = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(60, buffer.byteLength))).replace(/\s+/g, ' ');
            return Promise.reject(new Error('That is not a GLB: the server sent ' + buffer.byteLength + ' bytes' +
                (peek ? ' starting with "' + peek + '"' : ' (an empty file)')));
        }

        return new Promise((resolve, reject) => {
            new THREE.GLTFLoader().parse(buffer, '', gltf => {
                try {
                    this._setup(gltf);
                    resolve(this);
                } catch (err) {
                    reject(err);
                }
            }, reject);
        });
    }

    // ------------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------------

    _setup(gltf) {
        this.scene = gltf.scene;
        this.scene.updateMatrixWorld(true);

        // Index the top-level nodes by name (the HUD is a flat list of pieces)
        this.scene.children.forEach(child => {
            this.nodes[child.name] = child;
        });

        this._setupCamera(gltf);
        this._setupLights();
        this._setupScreens();

        HUD3D_HIDDEN_NODES.forEach(name => this.setVisible(name, false));

        this._ray = new THREE.Raycaster();
        this._ndc = new THREE.Vector2();

        if (!this.options.headless) {
            this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.options.antialias });
            this.renderer.setClearColor(HUD3D_BG_COLOR);
            this.resize();
            window.addEventListener('resize', () => this.resize());
        }
    }

    _setupCamera(gltf) {
        // Use the camera the HUD was framed with in Blender
        this.camera = gltf.cameras && gltf.cameras[0];
        if (!this.camera) {
            const f = HUD3D_FALLBACK_CAMERA;
            this.camera = new THREE.PerspectiveCamera(f.fov, f.aspect, 0.1, 1000);
            this.camera.position.set(f.position[0], f.position[1], f.position[2]);
            this.camera.rotation.set(-Math.PI / 2, 0, 0);
            this.scene.add(this.camera);
        }
        this.baseFov = this.camera.fov;
        this.designAspect = this.camera.aspect || 16 / 9;
        this.scene.updateMatrixWorld(true);
    }

    _setupLights() {
        const L = HUD3D_LIGHTS;
        const box = new THREE.Box3().setFromObject(this.scene);
        const mid = box.getCenter(new THREE.Vector3());

        this.scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity));

        const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
        sun.position.set(mid.x + L.sunOffset[0], mid.y + L.sunOffset[1], mid.z + L.sunOffset[2]);
        sun.target.position.copy(mid);
        this.scene.add(sun);
        this.scene.add(sun.target);
    }

    _setupScreens() {
        const found = [];
        this.scene.traverse(obj => {
            if (obj.isMesh && obj.material && HUD3D_SCREEN_MATERIALS.indexOf(obj.material.name) >= 0) found.push(obj);
        });

        found.forEach(mesh => {
            const name = mesh.material.name;
            const metrics = HUD3D_PLANAR_UVS ? planarizeScreen(mesh) : measureScreen(mesh);
            if (!metrics) {
                console.warn('[Hud3D] Screen "' + name + '" has no usable UVs, skipping it');
                return;
            }

            // Canvas size: fixed width (game window) or pixel density (everything else)
            const cfg = Object.assign({}, HUD3D_SCREENS[name], this.options.screens && this.options.screens[name]);
            const aspect = metrics.size3D.h / metrics.size3D.w;
            let width, height;
            if (cfg.width) {
                width = cfg.width;
                height = Math.round(width * aspect);
            } else {
                const scale = cfg.scale || HUD3D_SMALL_SCREEN_SCALE;
                width = Math.max(16, Math.round(metrics.size3D.w * HUD3D_SCREEN_DENSITY * scale));
                height = Math.max(8, Math.round(metrics.size3D.h * HUD3D_SCREEN_DENSITY * scale));
            }

            const screen = new Hud3DScreen(name, mesh, metrics, width, height, !!cfg.live, this.options.headless);
            mesh.userData.hud3dScreen = screen;
            this.screens[name] = screen;
            this.pickables.push(mesh);

            // Pivot at the screen's own center, so it can scale from the middle (a node's origin is usually elsewhere).
            // Only for pieces grouped under a node: a lone mesh carries the node's own transform
            if (mesh.parent && mesh.parent !== this.scene) {
                mesh.geometry.computeBoundingBox();
                const c = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
                mesh.geometry.translate(-c.x, -c.y, -c.z);
                mesh.position.add(c);
            }
        });
        this.scene.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------------
    // Sizing
    // ------------------------------------------------------------------------

    resize() {
        this._fit(window.innerWidth, window.innerHeight);
    }

    setFit(mode) {
        this.fit = mode;
        if (this.renderer) this.resize();
    }

    // Keeps the HUD's framing at any window shape.
    //  contain: the whole HUD always fits (bars show on the sides or top)
    //  cover:   the window is always filled (the edges of the HUD can get cropped)
    _fit(width, height) {
        const aspect = width / height;
        const ratio = this.designAspect / aspect;
        const scale = this.fit === 'cover' ? Math.min(1, ratio) : Math.max(1, ratio);
        const toRad = Math.PI / 180;

        this.camera.fov = (2 * Math.atan(Math.tan(this.baseFov * toRad / 2) * scale)) / toRad;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();

        if (this.renderer) {
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, HUD3D_PIXEL_RATIO_CAP));
            this.renderer.setSize(width, height);
        }
    }

    // ------------------------------------------------------------------------
    // Frame
    // ------------------------------------------------------------------------

    // Call once per frame. Only screens that changed get uploaded
    render() {
        if (!this.renderer) return;

        // Time since the last frame, for the motion engine (capped so a stalled tab doesn't jump)
        const now = performance.now();
        const dt = this._lastTime ? Math.min(0.05, (now - this._lastTime) / 1000) : 0;
        this._lastTime = now;
        if (this.motion) this.motion.update(dt);

        for (const name in this.screens) {
            const s = this.screens[name];
            if (s.live || s.dirty) {
                s.texture.needsUpdate = true;
                s.dirty = false;
            }
        }
        this.renderer.render(this.scene, this.camera);
    }

    // ------------------------------------------------------------------------
    // Access
    // ------------------------------------------------------------------------

    screen(name) {
        return this.screens[name] || null;
    }

    node(name) {
        return this.nodes[name] || null;
    }

    setVisible(name, visible) {
        const node = this.nodes[name];
        if (node) node.visible = visible;
    }

    // Makes a node (a button, say) clickable for pick()
    addPickable(name) {
        const node = this.nodes[name];
        if (!node) return;
        node.traverse(obj => {
            if (obj.isMesh && this.pickables.indexOf(obj) < 0) this.pickables.push(obj);
        });
    }

    // ------------------------------------------------------------------------
    // Picking
    // ------------------------------------------------------------------------

    // What is under this window position? Returns null, or
    // { name, object, point, screen, canvasX, canvasY } (screen and canvas coordinates only for screens)
    pick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        this._ray.setFromCamera(this._ndc, this.camera);

        const hits = this._ray.intersectObjects(this.pickables, false);
        for (let i = 0; i < hits.length; i++) {
            const hit = hits[i];
            if (!this._isShown(hit.object)) continue;       // The raycaster doesn't care about visibility

            const result = { name: this._ownerName(hit.object), object: hit.object, point: hit.point, screen: null, canvasX: 0, canvasY: 0 };
            const screen = hit.object.userData.hud3dScreen;
            if (screen && hit.uv) {
                const r = screen.uvRect;
                result.screen = screen;
                result.canvasX = ((hit.uv.x - r.u0) / (r.u1 - r.u0)) * screen.width;
                result.canvasY = ((hit.uv.y - r.v0) / (r.v1 - r.v0)) * screen.height;
            }
            return result;
        }
        return null;
    }

    _isShown(obj) {
        for (let o = obj; o; o = o.parent) {
            if (!o.visible) return false;
        }
        return true;
    }

    // The top-level node a mesh belongs to (so a primitive of "Points" reports "Points")
    _ownerName(obj) {
        let o = obj;
        while (o.parent && o.parent !== this.scene) o = o.parent;
        return o.name;
    }

    // ------------------------------------------------------------------------
    // Input forwarding
    // ------------------------------------------------------------------------

    // Feeds mouse input on a screen to an existing 2D canvas, as if it were still sitting on the page.
    // The target canvas gets hidden, which makes getBoundingClientRect() return zeros, so the
    // coordinates we send are used as-is by the old mouse code (control.js needs no changes)
    forwardToCanvas(screenName, target) {
        const screen = this.screens[screenName];
        if (!screen) return;

        target.style.display = 'none';
        let captured = false;
        let last = { x: 0, y: 0 };

        const send = (type, x, y, e) => {
            target.dispatchEvent(new MouseEvent(type, {
                clientX: x, clientY: y, button: e.button || 0, buttons: e.buttons || 0, cancelable: true
            }));
        };
        const onScreen = (e) => {
            const hit = this.pick(e.clientX, e.clientY);
            return hit && hit.screen === screen ? hit : null;
        };

        this.canvas.addEventListener('pointerdown', (e) => {
            const hit = onScreen(e);
            if (!hit) return;
            captured = true;
            this.canvas.setPointerCapture(e.pointerId);     // Keep the drag even when the pointer leaves the screen
            last = { x: hit.canvasX, y: hit.canvasY };
            send('mousedown', last.x, last.y, e);
        });

        this.canvas.addEventListener('pointermove', (e) => {
            const hit = onScreen(e);
            if (hit) {
                last = { x: hit.canvasX, y: hit.canvasY };
                send('mousemove', last.x, last.y, e);
                this.canvas.style.cursor = target.style.cursor || 'default';   // The game sets grab / pointer / grabbing on its canvas
            } else if (!captured) {
                this.canvas.style.cursor = 'default';
            }
        });

        this.canvas.addEventListener('pointerup', (e) => {
            if (!captured) return;
            captured = false;
            const hit = onScreen(e);
            send('mouseup', last.x, last.y, e);             // Off the screen? Release where it last was
            if (hit) send('click', hit.canvasX, hit.canvasY, e);
        });
    }
}

// ============================================================================
// INIT
// ============================================================================

// Creates the HUD and loads it. Resolves with the Hud3D
function initHud3D(canvas, options) {
    const hud = new Hud3D(canvas, options);
    return hud.load();
}

// Export if using modules (the smoke test does)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Hud3D, Hud3DScreen, measureScreen, planarizeScreen, initHud3D, HUD3D_SCREEN_MATERIALS };
}
