// ============================================================================
// HUD 3D MOTION
// ============================================================================
// Loadout switching for the 3D HUD. A switch has three beats:
//   1. The tops (screens, buttons, joystick...) retract
//   2. The frame pieces flip over like a revolving panel, and the Googie star lifts, spins, and settles
//   3. The new loadout's tops come in
//
// Needs hud3d.js (and three-bundle.js) loaded first.
//
//   hud3d.motion = new Hud3DMotion(hud3d);
//   hud3d.motion.setLoadout('game');            // Jump straight to a loadout, no animation
//   hud3d.motion.transitionTo('menu');          // Animate there. Returns a Promise
//   hud3d.motion.playExit('game');              // Leaving a page: retract, then flip to the next page's frames
//   hud3d.motion.playEnter('game');             // Arriving on a page: tops come in (and the wires build)
//   hud3d.motion.revealWires();                 // The rainbow builds across the top
//   hud3d.motion.timeScale = 0.25;              // Slow motion, for inspecting

// ============================================================================
// MOTION CONSTANTS
// ============================================================================

const HUD3D_MOTION_VERSION = '2026-11-26 flip direction + MHUD names';   // Shown on the test page
const HUD3D_SURFACE_Y = 0.0;                     // Anything below this is hidden under the frames. Rising pieces start there
const HUD3D_PHASE_GAP = 0.05;                    // Pause between the beats, in seconds
const HUD3D_FLIP_DURATION = 0.9;                 // How long a frame piece takes to flip
const HUD3D_FLIP_RIGHT_DELAY = 0.12;             // The right side follows the left, for a little ripple
const HUD3D_FLIP_EASE = 'servo';                 // Clunks into place with a tiny overshoot
const HUD3D_FLIP_DIRECTION = 1;                 // 1 or -1: which way the frames turn over (flip it if they go the wrong way)
const HUD3D_SWING_DIRECTION = 1;                // 1 or -1: which way the mode screen swings up from underneath
const HUD3D_FRAME_AXIS = { y: -0.08, z: -2.52 }; // The line every frame piece flips around (bottom of the slab, center of the panel)
const HUD3D_DEFAULT_EASE = 'inOut';
const HUD3D_EXPAND_LINE = 0.03;                  // Screens open as a thin line first (fraction of their height)

// The Googie star lifts clear of the main frame (its rim is 0.1 above the star's underside), spins, then settles
const HUD3D_STAR = { node: 'GoogieStar', lift: 0.12, turns: 2, duration: 1.1, ease: 'inOut' };

// The wires build across the top. Each color band starts a beat after the last
const HUD3D_WIRES = { node: 'Wires', bandDelay: 0.12, duration: 1.3, direction: 'ltr', ease: 'inOut' };   // ltr = left to right, rtl = right to left

// ============================================================================
// LOADOUTS
// ============================================================================
// frames: the left and right frame-bottom pieces this loadout uses (the others flip away)
// pieces: everything sitting on top, and how it comes in. Leaving is the same motion played backward
//   rise:   comes up from under the frame        { delay, duration, depth?, ease? }
//   swing:  swings up from underneath, flipping  { delay, duration, ease? }
//   expand: screens open wide, then tall         { delay, duration, screens: [screen material names], ease? }
// Times are in seconds, from the start of that loadout's entrance

const HUD3D_LOADOUTS = {
    menu: {
        frames: { left: 'LeftFrameBottom', right: 'RightFrameBottom' },
        pieces: {
            BigRedButtonSetting: { rise: { delay: 0.00, duration: 0.35 } },
            BigRedButton:        { rise: { delay: 0.20, duration: 0.40 } },
            BoomerangScreen:     { swing: { delay: 0.05, duration: 0.55 },
                                   expand: { delay: 0.45, duration: 0.35, screens: ['ModeScreen'] } },
            Joystick:            { rise: { delay: 0.15, duration: 0.45 } },
            ButtonSettings:      { rise: { delay: 0.25, duration: 0.30 } },
            ButtonHelp:          { rise: { delay: 0.32, duration: 0.30 } }
        }
    },
    game: {
        frames: { left: 'LeftFrameBottom2', right: 'RightFrameBottom2' },
        pieces: {
            Radio:               { rise: { delay: 0.00, duration: 0.30 },
                                   expand: { delay: 0.30, duration: 0.35, screens: ['RadioFace'] } },
            RadioDial:           { rise: { delay: 0.15, duration: 0.30 } },
            RadioPresets1:       { rise: { delay: 0.20, duration: 0.28 } },
            RadioPresets2:       { rise: { delay: 0.26, duration: 0.28 } },
            RadioPresets3:       { rise: { delay: 0.32, duration: 0.28 } },
            RadioAMFMHousing:    { rise: { delay: 0.20, duration: 0.28 } },
            RadioAMFMSlider:     { rise: { delay: 0.30, duration: 0.28 } },
            V:                   { rise: { delay: 0.35, duration: 0.28 } },
            ButtonMoonbeam:      { rise: { delay: 0.00, duration: 0.30 } },
            ButtonStardust:      { rise: { delay: 0.06, duration: 0.30 } },
            MoonbeamScreen:      { rise: { delay: 0.00, duration: 0.30 },
                                   expand: { delay: 0.30, duration: 0.40, screens: ['MoonbeamScreen'] } },
            StardustScreen:      { rise: { delay: 0.06, duration: 0.30 },
                                   expand: { delay: 0.36, duration: 0.40, screens: ['StardustScreen'] } },
            LifeScreen:          { rise: { delay: 0.10, duration: 0.28 },
                                   expand: { delay: 0.35, duration: 0.35, screens: ['LivesScreen'] } },
            CenterConsoleScreen: { rise: { delay: 0.15, duration: 0.28 },
                                   expand: { delay: 0.40, duration: 0.35, screens: ['JunkScreen'] } },
            PowerupScreen:       { rise: { delay: 0.20, duration: 0.28 },
                                   expand: { delay: 0.45, duration: 0.40, screens: ['PowerupMarqueeScreen'] } },
            DialScreens:         { rise: { delay: 0.25, duration: 0.28 },
                                   expand: { delay: 0.50, duration: 0.35, screens: ['DialScreen', 'LowFuelScreen'] } },
            ButtonBack:          { rise: { delay: 0.20, duration: 0.30 } },
            ButtonRefresh:       { rise: { delay: 0.26, duration: 0.30 } },
            ButtonPlayPause:     { rise: { delay: 0.32, duration: 0.30 } },
            Pause:               { rise: { delay: 0.32, duration: 0.30 } },
            ButtonSettings:      { rise: { delay: 0.38, duration: 0.30 } },
            ButtonHelp:          { rise: { delay: 0.44, duration: 0.30 } },
            RocketButton:        { rise: { delay: 0.50, duration: 0.30 } }
        }
    }
};

// ============================================================================
// EASING
// ============================================================================

const HUD3D_EASE = {
    linear: (t) => t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    // Eases out with a small overshoot, like a servo settling
    servo: (t) => 1 + 2.1 * Math.pow(t - 1, 3) + 1.1 * Math.pow(t - 1, 2)
};

// 'ratchet8' = inOut, but in 8 distinct ticks (any number works)
function hud3dEase(name) {
    if (HUD3D_EASE[name]) return HUD3D_EASE[name];
    const m = /^ratchet(\d+)$/.exec(name || '');
    if (m) {
        const n = parseInt(m[1], 10);
        return (t) => Math.round(HUD3D_EASE.inOut(t) * n) / n;
    }
    return HUD3D_EASE[HUD3D_DEFAULT_EASE];
}

function hud3dClamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Progress (0 to 1) of a sub-motion, given the time since its piece's timeline started
function hud3dProgress(t, m) {
    return hud3dClamp01((t - m.delay) / m.duration);
}

// ============================================================================
// MOTION
// ============================================================================

class Hud3DMotion {
    constructor(hud) {
        this.hud = hud;
        this.loadouts = HUD3D_LOADOUTS;
        this.timeScale = 1;
        this.current = null;                     // The loadout the HUD is in (or heading to, once an animation finishes)
        this.tracks = [];                        // Running animations
        this.busy = null;                        // The running transition, if any
        this.rest = {};                          // Node name -> its resting pose
        this.wireBands = [];

        this._captureRest();
        this._setupWires();
    }

    // ------------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------------

    _allNodeNames() {
        const names = {};
        for (const key in this.loadouts) {
            const L = this.loadouts[key];
            names[L.frames.left] = true;
            names[L.frames.right] = true;
            for (const piece in L.pieces) names[piece] = true;
        }
        names[HUD3D_STAR.node] = true;
        return Object.keys(names);
    }

    // Remembers where every animated piece rests, and how deep it has to sink to vanish under the frame
    _captureRest() {
        this._allNodeNames().forEach(name => {
            const node = this.hud.nodes[name];
            if (!node) {
                console.warn('[Hud3DMotion] No node named "' + name + '" in the model');
                return;
            }
            const box = new THREE.Box3().setFromObject(node);
            this.rest[name] = {
                pos: node.position.clone(),
                quat: node.quaternion.clone(),
                scale: node.scale.clone(),
                depth: Math.max(0.1, box.max.y - HUD3D_SURFACE_Y + 0.01)
            };
        });
    }

    // Each wire band gets its own copy of its material (the originals are shared with buttons), so it can be clipped on its own
    _setupWires() {
        const node = this.hud.nodes[HUD3D_WIRES.node];
        if (!node) return;
        const box = new THREE.Box3().setFromObject(node);
        this.wireRange = { x0: box.min.x - 0.01, x1: box.max.x + 0.01 };

        node.traverse(obj => {
            if (!obj.isMesh) return;
            obj.material = obj.material.clone();
            this.wireBands.push({ material: obj.material, plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0) });
        });
    }

    // ------------------------------------------------------------------------
    // Public
    // ------------------------------------------------------------------------

    // Jumps straight to a loadout. tops = false leaves the tops hidden (for playEnter)
    setLoadout(name, tops) {
        this._settle(name, tops !== false);
    }

    // Animates from the current loadout to another: retract, flip, enter
    transitionTo(name) {
        if (this.busy) return this.busy.promise;
        if (!this.current) this._settle(name, true);
        if (name === this.current) return Promise.resolve();
        return this._run(this._plan(this.current, name, { exit: true, flip: true, enter: true }));
    }

    // Page is closing: retract, then flip to the frames the next page starts with. Tops stay hidden
    playExit(toName) {
        if (this.busy) return this.busy.promise;
        return this._run(this._plan(this.current, toName, { exit: true, flip: true, enter: false }));
    }

    // Page just opened: frames are already in place, the tops come in, and the wires build
    playEnter(name, withWires) {
        this._settle(name, false);
        if (withWires !== false) this.revealWires();
        return this._run(this._plan(name, name, { exit: false, flip: false, enter: true }));
    }

    // The Googie star: lift, spin, settle
    spinStar() {
        return this._start({ duration: HUD3D_STAR.duration, apply: (t) => this._poseStar(t / HUD3D_STAR.duration), finish: () => this._poseStar(0) });
    }

    // The wires build across the top
    revealWires() {
        if (!this.wireBands.length) return Promise.resolve();
        const total = HUD3D_WIRES.duration + HUD3D_WIRES.bandDelay * (this.wireBands.length - 1);
        this.wireBands.forEach(b => {
            b.material.clippingPlanes = [b.plane];
            b.material.needsUpdate = true;
        });
        if (this.hud.renderer) this.hud.renderer.localClippingEnabled = true;
        return this._start({
            duration: total,
            apply: (t) => this._poseWires(t),
            finish: () => this.wireBands.forEach(b => {
                b.material.clippingPlanes = null;        // Done: stop paying for the clipping
                b.material.needsUpdate = true;
            })
        });
    }

    get busyNow() {
        return this.tracks.length > 0;
    }

    // Call once per frame (hud3d.render() does this for you)
    update(dt) {
        const step = dt * this.timeScale;
        for (let i = this.tracks.length - 1; i >= 0; i--) {
            const track = this.tracks[i];
            track.t += step;
            const t = Math.min(track.t, track.duration);
            track.apply(t);
            if (track.t >= track.duration) {
                this.tracks.splice(i, 1);
                if (track.finish) track.finish();
                track.resolve();
            }
        }
    }

    // ------------------------------------------------------------------------
    // Scheduling
    // ------------------------------------------------------------------------

    _start(track) {
        track.t = 0;
        track.promise = new Promise(resolve => { track.resolve = resolve; });
        this.tracks.push(track);
        track.apply(0);
        return track.promise;
    }

    _run(plan) {
        const track = {
            duration: plan.total,
            apply: (t) => this._applyPlan(plan, t),
            finish: () => {
                this._settle(plan.to, plan.parts.enter);
                this.busy = null;
            }
        };
        this.busy = track;
        return this._start(track);
    }

    // How long a loadout's entrance takes: the last piece to finish
    _span(loadout) {
        let span = 0;
        for (const name in loadout.pieces) {
            const spec = loadout.pieces[name];
            ['rise', 'swing', 'expand'].forEach(k => {
                if (spec[k]) span = Math.max(span, spec[k].delay + spec[k].duration);
            });
        }
        return span;
    }

    _plan(from, to, parts) {
        const exitSpan = parts.exit ? this._span(this.loadouts[from]) : 0;
        const flipStart = exitSpan + (parts.exit ? HUD3D_PHASE_GAP : 0);
        const flipSpan = parts.flip ? HUD3D_FLIP_DURATION + HUD3D_FLIP_RIGHT_DELAY : 0;
        const enterStart = flipStart + flipSpan + (parts.flip ? HUD3D_PHASE_GAP : 0);
        const enterSpan = parts.enter ? this._span(this.loadouts[to]) : 0;
        let total = enterStart + enterSpan;
        if (parts.flip) total = Math.max(total, flipStart + HUD3D_STAR.duration);
        return { from: from, to: to, parts: parts, exitSpan: exitSpan, flipStart: flipStart, enterStart: enterStart, total: total };
    }

    // ------------------------------------------------------------------------
    // Posing
    // ------------------------------------------------------------------------

    _applyPlan(plan, t) {
        const F = this.loadouts[plan.from];
        const T = this.loadouts[plan.to];
        const parts = plan.parts;

        // Tops: leaving ones play their entrance backward, entering ones play it forward
        const names = {};
        if (parts.exit) for (const n in F.pieces) names[n] = true;
        if (parts.enter) for (const n in T.pieces) names[n] = true;

        for (const name in names) {
            const inFrom = parts.exit && F.pieces[name];
            const inTo = parts.enter && T.pieces[name];
            let spec, local;
            if (inTo && t >= plan.enterStart) { spec = inTo; local = t - plan.enterStart; }
            else if (inFrom) { spec = inFrom; local = plan.exitSpan - t; }
            else { spec = inTo; local = t - plan.enterStart; }
            this._posePiece(name, spec, local);
        }

        // Frames: one flips away as the other flips in
        if (parts.flip) {
            ['left', 'right'].forEach(side => {
                const outName = F.frames[side];
                const inName = T.frames[side];
                if (outName === inName) return;
                const delay = side === 'right' ? HUD3D_FLIP_RIGHT_DELAY : 0;
                const p = hud3dClamp01((t - plan.flipStart - delay) / HUD3D_FLIP_DURATION);
                this._poseFlip(outName, inName, hud3dEase(HUD3D_FLIP_EASE)(p), p);
            });
            this._poseStar(hud3dClamp01((t - plan.flipStart) / HUD3D_STAR.duration));
        }
    }

    // Sets a piece's pose from the time since its own timeline started
    _posePiece(name, spec, local) {
        const node = this.hud.nodes[name];
        const rest = this.rest[name];
        if (!node || !rest) return;

        let started = false;

        if (spec.rise) {
            const p = hud3dProgress(local, spec.rise);
            const e = hud3dEase(spec.rise.ease)(p);
            const depth = spec.rise.depth || rest.depth;
            node.position.copy(rest.pos);
            node.position.y = rest.pos.y - depth * (1 - e);
            if (p > 0) started = true;
        }

        if (spec.swing) {
            const p = hud3dProgress(local, spec.swing);
            const e = hud3dEase(spec.swing.ease)(p);
            this._rotateAbout(name, HUD3D_SURFACE_Y, rest.pos.z, HUD3D_SWING_DIRECTION * Math.PI * (1 - e));
            if (p > 0) started = true;
        }

        if (spec.expand) {
            const p = hud3dProgress(local, spec.expand);
            const ease = hud3dEase(spec.expand.ease);
            const w = ease(hud3dClamp01(p / 0.5));
            const h = ease(hud3dClamp01((p - 0.5) / 0.5));
            spec.expand.screens.forEach(screenName => {
                const screen = this.hud.screens[screenName];
                if (!screen) return;
                screen.mesh.visible = p > 0;
                screen.mesh.scale.set(Math.max(w, 1e-4), 1, HUD3D_EXPAND_LINE + (1 - HUD3D_EXPAND_LINE) * h);
            });
            if (p > 0) started = true;
        }

        node.visible = started;
    }

    // Rotates a piece about a line parallel to X, through (y0, z0), starting from its rest pose
    _rotateAbout(name, y0, z0, angle) {
        const node = this.hud.nodes[name];
        const rest = this.rest[name];
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
        const pivot = new THREE.Vector3(rest.pos.x, y0, z0);
        node.position.copy(rest.pos).sub(pivot).applyQuaternion(q).add(pivot);
        node.quaternion.copy(q).multiply(rest.quat);
    }

    // The outgoing frame turns over and away while the incoming one turns up from underneath
    _poseFlip(outName, inName, e, p) {
        const out = this.hud.nodes[outName];
        const inn = this.hud.nodes[inName];
        this._rotateAbout(outName, HUD3D_FRAME_AXIS.y, HUD3D_FRAME_AXIS.z, HUD3D_FLIP_DIRECTION * Math.PI * e);
        this._rotateAbout(inName, HUD3D_FRAME_AXIS.y, HUD3D_FRAME_AXIS.z, HUD3D_FLIP_DIRECTION * (Math.PI * e - Math.PI));
        out.visible = p < 1;
        inn.visible = p > 0;
    }

    _poseStar(p) {
        const node = this.hud.nodes[HUD3D_STAR.node];
        const rest = this.rest[HUD3D_STAR.node];
        if (!node || !rest) return;
        const ease = hud3dEase(HUD3D_STAR.ease);

        // Up, hold, down
        let lift = 1;
        if (p < 0.2) lift = ease(p / 0.2);
        else if (p > 0.8) lift = 1 - ease((p - 0.8) / 0.2);
        if (p <= 0 || p >= 1) lift = 0;

        // Spin while it is up there
        const spin = Math.PI * 2 * HUD3D_STAR.turns * ease(hud3dClamp01((p - 0.15) / 0.7));
        node.position.copy(rest.pos);
        node.position.y += HUD3D_STAR.lift * lift;
        node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin).multiply(rest.quat);
    }

    _poseWires(t) {
        const ease = hud3dEase(HUD3D_WIRES.ease);
        const ltr = HUD3D_WIRES.direction !== 'rtl';
        const r = this.wireRange;
        this.wireBands.forEach((band, i) => {
            const p = hud3dClamp01((t - i * HUD3D_WIRES.bandDelay) / HUD3D_WIRES.duration);
            const e = ease(p);
            if (ltr) {
                const edge = r.x0 + (r.x1 - r.x0) * e;      // Keep everything left of the edge
                band.plane.normal.set(-1, 0, 0);
                band.plane.constant = edge;
            } else {
                const edge = r.x1 - (r.x1 - r.x0) * e;      // Keep everything right of the edge
                band.plane.normal.set(1, 0, 0);
                band.plane.constant = -edge;
            }
        });
    }

    // ------------------------------------------------------------------------
    // Resting states
    // ------------------------------------------------------------------------

    _reset(name) {
        const node = this.hud.nodes[name];
        const rest = this.rest[name];
        if (!node || !rest) return;
        node.position.copy(rest.pos);
        node.quaternion.copy(rest.quat);
        node.scale.copy(rest.scale);
    }

    _resetScreens(spec) {
        if (!spec.expand) return;
        spec.expand.screens.forEach(screenName => {
            const screen = this.hud.screens[screenName];
            if (!screen) return;
            screen.mesh.scale.set(1, 1, 1);
            screen.mesh.visible = true;
        });
    }

    // Puts everything at rest: this loadout's frames and (optionally) tops shown, every other piece hidden
    _settle(name, tops) {
        const target = this.loadouts[name];
        for (const key in this.loadouts) {
            const L = this.loadouts[key];
            const isTarget = key === name;
            [L.frames.left, L.frames.right].forEach(f => {
                this._reset(f);
                if (this.hud.nodes[f]) this.hud.nodes[f].visible = isTarget;
            });
            for (const piece in L.pieces) {
                if (isTarget) continue;
                if (target.pieces[piece]) continue;     // Shared with the target: handled below
                this._reset(piece);
                this._resetScreens(L.pieces[piece]);
                if (this.hud.nodes[piece]) this.hud.nodes[piece].visible = false;
            }
        }
        for (const piece in target.pieces) {
            this._reset(piece);
            this._resetScreens(target.pieces[piece]);
            if (this.hud.nodes[piece]) this.hud.nodes[piece].visible = tops;
        }
        this._reset(HUD3D_STAR.node);
        this.current = name;
    }
}

// Export if using modules (the smoke test does)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Hud3DMotion, HUD3D_LOADOUTS, hud3dEase };
}
