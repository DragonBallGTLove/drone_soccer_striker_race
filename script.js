
const CONFIG = {
    easy: { ringCount: 9, trackLength: 840, speedMultiplier: 0.75 },
    medium: { ringCount: 12, trackLength: 1080, speedMultiplier: 1 },
    hard: { ringCount: 15, trackLength: 1350, speedMultiplier: 1.25 }
};

function getTrackLength() {
    const isExtendedTrack = currentMode === 'superspeed' || currentMode === 'hardest';
    return CONFIG[currentDiff].trackLength * (isExtendedTrack ? 1.5 : 1);
}

// Tuned gear multipliers & acceleration for STANDARD MODE (slightly slower & smoother)
const SPEED_GEARS = {
    GEAR1: { name: 'GEAR 1 / 3', multiplier: 1.1, accel: 100, color: 'text-amber-400', bg: 'bg-amber-500/20', border: 'border-amber-400/40' },
    GEAR2: { name: 'GEAR 2 / 3', multiplier: 2.1, accel: 140, color: 'text-cyan-300', bg: 'bg-cyan-500/20', border: 'border-cyan-400/40' },
    GEAR3: { name: 'GEAR 3 / 3', multiplier: 3.2, accel: 210, color: 'text-pink-400', bg: 'bg-pink-500/20', border: 'border-pink-400/40' },
    GEAR4: { name: 'GEAR 4 / 4', multiplier: 3.8, accel: 250, color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-400/40' }
};

const GEAR_ORDER = ['GEAR1', 'GEAR2', 'GEAR3']
const HARDEST_GEAR_ORDER = [...GEAR_ORDER, 'GEAR4'];
let currentGear = 'GEAR2';

let currentDiff = 'easy';
let currentMode = 'standard';
let gameState = 'MENU';
let countdownRemaining = 0;
let score = 0;
let shield = 100;
let elapsedGameTime = 0;
let ringsPassedCount = 0;
let pendingRankingScore = null;
let rankingEntrySubmitted = false;

const RANKING_STORAGE_KEY = 'ds_global_ranking_v1';
const LEGACY_RANKING_NICKNAME_KEY = 'ds_ranking_nickname';

const dronePhysics = {
    pos: new THREE.Vector3(0, 5, -10),
    vel: new THREE.Vector3(0, 0, 0),
    drag: 0.93,
    baseMaxSpeed: 110, // Slower base max speed for fine-tuned precision
    radius: 1.2
};

// Key State Mapping
const keys = {
    Forward: false,
    Backward: false,
    Left: false,
    Right: false,
    Up: false,
    Down: false,
    RotateLeft: false,
    RotateRight: false
};
let droneHeading = 0;

class SoundSystem {
    constructor() {
        this.ctx = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.engineVca = null;
        this.enginePulseOsc = null;
        this.enginePulseGain = null;
    }

    init() {
        if (this.ctx) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioCtx();
        this.ctx.resume().catch(error => console.error('Unable to resume audio context:', error));

        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        this.engineVca = this.ctx.createGain();
        this.enginePulseOsc = this.ctx.createOscillator();
        this.enginePulseGain = this.ctx.createGain();
        this.engineOsc.type = 'triangle';
        this.engineOsc.frequency.setValueAtTime(90, this.ctx.currentTime);
        this.enginePulseOsc.type = 'sine';
        this.enginePulseOsc.frequency.setValueAtTime(24, this.ctx.currentTime);
        this.engineVca.gain.setValueAtTime(0.72, this.ctx.currentTime);
        this.enginePulseGain.gain.setValueAtTime(0.28, this.ctx.currentTime);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(750, this.ctx.currentTime);

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.engineVca);
        this.engineVca.connect(this.ctx.destination);
        this.enginePulseOsc.connect(this.enginePulseGain);
        this.enginePulseGain.connect(this.engineVca.gain);
        this.engineGain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        this.engineOsc.start();
        this.enginePulseOsc.start();

    }

    updateEngine(speed, isFlying) {
        if (!this.ctx) return;
        const gearMult = SPEED_GEARS[currentGear].multiplier;
        const isHighSpeedMode = currentMode === 'superspeed' || currentMode === 'hardest';
        const modeMult = isHighSpeedMode ? 1.8 : 1.0;
        const rotorSpeed = Math.min(speed, 250);
        const pitch = (65 + (rotorSpeed * 0.55 * gearMult)) * (isHighSpeedMode ? 1.2 : 1.0);
        const volume = isFlying ? Math.min(0.22, 0.04 + (speed * 0.0012)) : 0;
        const bladeRate = 14 + rotorSpeed * 0.08 * gearMult * modeMult;
        this.engineOsc.frequency.setTargetAtTime(pitch, this.ctx.currentTime, 0.08);
        this.enginePulseOsc.frequency.setTargetAtTime(bladeRate, this.ctx.currentTime, 0.08);
        this.engineGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.08);
    }

    playRingPass() {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(650, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1300, this.ctx.currentTime + 0.18);
        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.18);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.18);
    }

    playCrash() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 0.25;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
        noise.connect(gain);
        gain.connect(this.ctx.destination);
        noise.start();
    }

    playVictory() {
        if (!this.ctx) return;
        const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.08);
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + idx * 0.08 + 0.35);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime + idx * 0.08);
            osc.stop(this.ctx.currentTime + idx * 0.08 + 0.35);
        });
    }
}

const audio = new SoundSystem();

function cycleGear() {
    const gearOrder = currentMode === 'hardest' ? HARDEST_GEAR_ORDER : GEAR_ORDER;
    const idx = gearOrder.indexOf(currentGear);
    currentGear = gearOrder[(idx + 1) % gearOrder.length];
    updateGearUI();
}

function updateGearUI() {
    const gearInfo = SPEED_GEARS[currentGear];
    const gearOrder = currentMode === 'hardest' ? HARDEST_GEAR_ORDER : GEAR_ORDER;
    const gearName = `GEAR ${gearOrder.indexOf(currentGear) + 1} / ${gearOrder.length}`;
    const badge = document.getElementById('hud-gear-badge');
    if (badge) {
        badge.className = `font-orbitron font-extrabold px-2 py-0.5 rounded text-[11px] ${gearInfo.bg} ${gearInfo.color} border ${gearInfo.border}`;
        badge.innerText = gearName;
    }
    const mobileBtnLabel = document.getElementById('btn-gear-label');
    if (mobileBtnLabel) mobileBtnLabel.innerText = gearName;
}

function triggerDamageVignette() {
    const flash = document.getElementById('damage-flash');
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 220);
}

function setupControls() {
    window.addEventListener('keydown', (e) => {
        if (currentMode === 'hardest' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code)) {
            e.preventDefault();
        } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            e.preventDefault();
        }
        if (gameState !== 'PLAYING') return;

        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            if (!e.repeat) cycleGear();
            return;
        }

        if (currentMode === 'hardest') {
            switch (e.code) {
                case 'ArrowLeft': keys.Left = true; break;
                case 'ArrowRight': keys.Right = true; break;
                case 'ArrowUp': keys.Forward = true; break;
                case 'ArrowDown': keys.Backward = true; break;
                case 'KeyA': keys.RotateLeft = true; break;
                case 'KeyD': keys.RotateRight = true; break;
                case 'KeyW': keys.Up = true; break;
                case 'KeyS': keys.Down = true; break;
            }
        } else {
            switch (e.code) {
                case 'KeyA': case 'ArrowLeft': keys.Left = true; break;
                case 'KeyD': case 'ArrowRight': keys.Right = true; break;
                case 'KeyW': case 'ArrowUp': case 'Space': keys.Up = true; break;
                case 'KeyS': case 'ArrowDown': case 'KeyC': keys.Down = true; break;
            }
        }
    });

    window.addEventListener('keyup', (e) => {
        if (currentMode === 'hardest' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(e.code)) {
            e.preventDefault();
        } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            e.preventDefault();
        }
        if (currentMode === 'hardest') {
            switch (e.code) {
                case 'ArrowLeft': keys.Left = false; break;
                case 'ArrowRight': keys.Right = false; break;
                case 'ArrowUp': keys.Forward = false; break;
                case 'ArrowDown': keys.Backward = false; break;
                case 'KeyA': keys.RotateLeft = false; break;
                case 'KeyD': keys.RotateRight = false; break;
                case 'KeyW': keys.Up = false; break;
                case 'KeyS': keys.Down = false; break;
            }
        } else {
            switch (e.code) {
                case 'KeyA': case 'ArrowLeft': keys.Left = false; break;
                case 'KeyD': case 'ArrowRight': keys.Right = false; break;
                case 'KeyW': case 'ArrowUp': case 'Space': keys.Up = false; break;
                case 'KeyS': case 'ArrowDown': case 'KeyC': keys.Down = false; break;
            }
        }
    });

    // Touch Joystick
    const zone = document.getElementById('touch-joystick-zone');
    const knob = document.getElementById('touch-joystick-knob');
    let touchId = null;
    let center = { x: 0, y: 0 };

    zone.addEventListener('touchstart', (e) => {
        if (touchId !== null) return;
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
        const rect = zone.getBoundingClientRect();
        center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        updateJoystick(touch);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (touchId === null) return;
        for (let touch of e.changedTouches) {
            if (touch.identifier === touchId) {
                updateJoystick(touch);
                break;
            }
        }
    }, { passive: false });

    const resetJoystick = () => {
        touchId = null;
        knob.style.transform = `translate(0px, 0px)`;
        keys.Left = keys.Right = false;
        keys.Forward = keys.Backward = false;
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);

    function updateJoystick(touch) {
        const dx = touch.clientX - center.x;
        const dy = touch.clientY - center.y;
        const dist = Math.min(Math.hypot(dx, dy), 36);
        const angle = Math.atan2(dy, dx);

        knob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;

        keys.Left = dx < -10;
        keys.Right = dx > 10;
        keys.Forward = currentMode === 'hardest' && dy < -10;
        keys.Backward = currentMode === 'hardest' && dy > 10;
    }

    const setupTouchBtn = (id, keyName) => {
        const btn = document.getElementById(id);
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[keyName] = true; });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[keyName] = false; });
        btn.addEventListener('mousedown', () => { keys[keyName] = true; });
        btn.addEventListener('mouseup', () => { keys[keyName] = false; });
    };
    setupTouchBtn('btn-up', 'Up');
    setupTouchBtn('btn-down', 'Down');
    setupTouchBtn('btn-rotate-left', 'RotateLeft');
    setupTouchBtn('btn-rotate-right', 'RotateRight');
}

const GOAL_RING_RADIUS = 5.8;
const GOAL_RING_TUBE_RADIUS = 1.15;

let scene, camera, renderer, playerDroneGroup, innerCoreMesh, thrusterGlowMesh;
let rings = [], goalRingMesh, defenders = [], particleSystem;

function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030712, 0.0035);

    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 1200);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x1a2640, 1.6));
    const cyanLight = new THREE.DirectionalLight(0x00f0ff, 1.8);
    cyanLight.position.set(20, 40, -20);
    scene.add(cyanLight);

    createArenaMesh();
    createPlayerDrone();
    createParticleBackground();

    window.addEventListener('resize', onWindowResize);
}

function createArenaMesh() {
    const fieldWidth = 64;
    const fieldStart = -80;
    const fieldLength = 2300;
    const fieldCenterZ = fieldStart + fieldLength / 2;
    const turf = new THREE.Mesh(
        new THREE.PlaneGeometry(fieldWidth, fieldLength),
        new THREE.MeshStandardMaterial({ color: 0x1f632b, roughness: 1 })
    );
    turf.rotation.x = -Math.PI / 2;
    turf.position.set(0, -0.05, fieldCenterZ);
    scene.add(turf);

    const stripeLength = 100;
    for (let z = fieldStart + stripeLength / 2, stripeIndex = 0;
        z < fieldStart + fieldLength;
        z += stripeLength, stripeIndex++) {
        if (stripeIndex % 2 === 0) continue;
        const stripe = new THREE.Mesh(
            new THREE.PlaneGeometry(fieldWidth, stripeLength),
            new THREE.MeshStandardMaterial({ color: 0x275f30, roughness: 1 })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(0, -0.03, z);
        scene.add(stripe);
    }

    const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xe8f2df, roughness: 1 });
    const addLine = (x, z, width, depth) => {
        const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.04, depth), lineMaterial);
        line.position.set(x, 0.01, z);
        scene.add(line);
    };

    const sideX = fieldWidth / 2 - 2;
    const endZ = fieldStart + fieldLength - 100;
    addLine(-sideX, fieldCenterZ, 0.35, fieldLength - 20);
    addLine(sideX, fieldCenterZ, 0.35, fieldLength - 20);
    addLine(0, fieldStart + 30, fieldWidth - 4, 0.35);
    addLine(0, endZ, fieldWidth - 4, 0.35);
    addLine(0, fieldCenterZ, fieldWidth - 4, 0.35);

    const centerCircle = new THREE.Mesh(
        new THREE.TorusGeometry(13, 0.22, 8, 64),
        lineMaterial
    );
    centerCircle.rotation.x = Math.PI / 2;
    centerCircle.position.set(0, 0.04, fieldCenterZ);
    scene.add(centerCircle);

    const boxWidth = 42;
    const boxDepth = 70;
    [-1, 1].forEach(end => {
        const goalLineZ = end < 0 ? fieldStart + 30 : endZ;
        const boxInnerZ = goalLineZ + (end < 0 ? boxDepth : -boxDepth);
        const boxCenterZ = (goalLineZ + boxInnerZ) / 2;
        addLine(-boxWidth / 2, boxCenterZ, 0.3, boxDepth);
        addLine(boxWidth / 2, boxCenterZ, 0.3, boxDepth);
        addLine(0, boxInnerZ, boxWidth, 0.3);
    });

    const netPositions = [];
    const netHeight = 26;
    const wallX = fieldWidth / 2;
    const fieldEnd = fieldStart + fieldLength;
    const addNetSegment = (x1, y1, z1, x2, y2, z2) => {
        netPositions.push(x1, y1, z1, x2, y2, z2);
    };

    [-wallX, wallX].forEach(x => {
        for (let z = fieldStart; z <= fieldEnd; z += 5) {
            addNetSegment(x, 0, z, x, netHeight, z);
        }
        for (let y = 0; y <= netHeight; y += 2) {
            addNetSegment(x, y, fieldStart, x, y, fieldEnd);
        }
    });

    [fieldStart, fieldEnd].forEach(z => {
        for (let x = -wallX; x <= wallX; x += 4) {
            addNetSegment(x, 0, z, x, netHeight, z);
        }
        for (let y = 0; y <= netHeight; y += 2) {
            addNetSegment(-wallX, y, z, wallX, y, z);
        }
    });

    const netGeometry = new THREE.BufferGeometry();
    netGeometry.setAttribute('position', new THREE.Float32BufferAttribute(netPositions, 3));
    const net = new THREE.LineSegments(
        netGeometry,
        new THREE.LineBasicMaterial({ color: 0xd5e1e7, transparent: true, opacity: 0.52, depthWrite: false })
    );
    scene.add(net);
}

function createPlayerDrone() {
    playerDroneGroup = new THREE.Group();

    const cageMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(dronePhysics.radius, 2),
        new THREE.MeshStandardMaterial({ color: 0xffffff, wireframe: true, emissive: 0xffffff, emissiveIntensity: 0.8 })
    );
    playerDroneGroup.add(cageMesh);

    innerCoreMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    playerDroneGroup.add(innerCoreMesh);

    const rearMarkerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xff2020 })
    );
    rearMarkerMesh.position.set(0, 0.45, -1.05);
    playerDroneGroup.add(rearMarkerMesh);

    thrusterGlowMesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.45, 2.2, 16),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.85 })
    );
    thrusterGlowMesh.rotation.x = -Math.PI / 2;
    thrusterGlowMesh.position.set(0, 0, -1.2);
    playerDroneGroup.add(thrusterGlowMesh);

    scene.add(playerDroneGroup);
}

function createParticleBackground() {
    const particleCount = 1800;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const starColors = [0xffffff, 0xc9ddff, 0xfff1d6, 0x9fc5ff];

    for (let i = 0; i < particleCount; i++) {
        const index = i * 3;
        positions[index] = (Math.random() - 0.5) * 1000;
        positions[index + 1] = 25 + Math.random() * 475;
        positions[index + 2] = -150 + Math.random() * 2500;

        const color = new THREE.Color(starColors[Math.floor(Math.random() * starColors.length)]);
        colors[index] = color.r;
        colors[index + 1] = color.g;
        colors[index + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
        size: 1.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false
    });
    particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);
}

function buildTrack(config) {
    rings.forEach(r => scene.remove(r.mesh));
    defenders.forEach(d => scene.remove(d.mesh));
    if (goalRingMesh) scene.remove(goalRingMesh);
    rings = [];
    defenders = [];

    const spacing = config.trackLength / config.ringCount;

    for (let i = 1; i <= config.ringCount; i++) {
        const zPos = i * spacing;
        const xPos = THREE.MathUtils.randFloat(-16, 16);
        const yPos = THREE.MathUtils.randFloat(5, 12);

        const ringMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffff,
            emissiveIntensity: 0.12,
            roughness: 0.35,
            metalness: 0.05
        });
        const ringGroup = new THREE.Group();
        ringGroup.add(new THREE.Mesh(
            new THREE.TorusGeometry(3.6, 0.9, 20, 48),
            ringMaterial
        ));
        ringGroup.position.set(xPos, yPos, zPos);
        scene.add(ringGroup);

        rings.push({
            mesh: ringGroup,
            passed: false,
            radius: 3.6,
            tubeRadius: 0.9,
            material: ringMaterial,
            collisionCooldown: 0,
            pos: ringGroup.position
        });
    }

    for (let i = 0; i < config.defenderCount; i++) {
        const defGroup = new THREE.Group();
        defGroup.add(new THREE.Mesh(
            new THREE.IcosahedronGeometry(1.5, 2),
            new THREE.MeshStandardMaterial({ color: 0xff0055, wireframe: true, emissive: 0xff0033 })
        ));

        const zPos = 30 + (i * (config.trackLength / config.defenderCount));
        const nearbyRing = rings.reduce((closest, ring) =>
            Math.abs(ring.pos.z - zPos) < Math.abs(closest.pos.z - zPos) ? ring : closest
        );
        const nearbyRingIndex = rings.indexOf(nearbyRing);
        const anchor = nearbyRing.pos.clone();
        if (i % 2 === 1) {
            const adjacentRingIndex = nearbyRingIndex === rings.length - 1
                ? nearbyRingIndex - 1
                : nearbyRingIndex + 1;
            anchor.lerp(rings[adjacentRingIndex].pos, 0.5);
        }
        anchor.z += 14;
        const startX = THREE.MathUtils.clamp(anchor.x + THREE.MathUtils.randFloat(-4, 4), -24, 24);
        const startY = THREE.MathUtils.clamp(anchor.y + THREE.MathUtils.randFloat(-3, 3), 2, 20);
        const startZ = anchor.z + THREE.MathUtils.randFloat(-2.5, 2.5);

        defGroup.position.set(startX, startY, startZ);
        scene.add(defGroup);

        defenders.push({
            mesh: defGroup,
            anchorX: anchor.x,
            anchorY: anchor.y,
            anchorZ: anchor.z,
            targetX: startX,
            targetY: startY,
            targetZ: startZ,
            directionChangeIn: 0,
            collisionCooldown: 0,
            knockbackVelocity: new THREE.Vector3(),
            radius: 1.5
        });
    }

    const goalZ = config.trackLength + 30;
    goalRingMesh = new THREE.Group();
    goalRingMesh.add(new THREE.Mesh(
        new THREE.TorusGeometry(GOAL_RING_RADIUS, GOAL_RING_TUBE_RADIUS, 24, 64),
        new THREE.MeshStandardMaterial({
            color: 0xFFFFFF,
            emissive: 0xFFFFFF,
            emissiveIntensity: 0.12,
            roughness: 0.35,
            metalness: 0.05
        })
    ));
    goalRingMesh.position.set(0, 7, goalZ);
    scene.add(goalRingMesh);
}

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (gameState === 'PLAYING') {
        updateGame(dt);
    } else if (gameState === 'COUNTDOWN') {
        countdownRemaining -= dt;
        if (countdownRemaining <= 0) {
            countdownRemaining = 0;
            gameState = 'PLAYING';
            Object.keys(keys).forEach(key => { keys[key] = false; });
            document.getElementById('countdown-overlay').classList.add('hidden');
            document.getElementById('countdown-overlay').classList.remove('flex');
        } else {
            document.getElementById('countdown-number').innerText = Math.ceil(countdownRemaining).toString();
        }
    }

    if (playerDroneGroup) {
        if (gameState === 'PLAYING') {
            camera.position.lerp(new THREE.Vector3(
                dronePhysics.pos.x,
                dronePhysics.pos.y + 2.8,
                dronePhysics.pos.z - 9.5
            ), 0.16);
            camera.position.x = dronePhysics.pos.x;
            camera.lookAt(dronePhysics.pos.x, dronePhysics.pos.y + 0.5, dronePhysics.pos.z + 12);
        } else {
            const t = now * 0.0005;
            camera.position.set(Math.sin(t) * 12, 6, Math.cos(t) * 12 - 10);
            camera.lookAt(0, 4, 0);
        }
    }

    renderer.render(scene, camera);
}

function updateGame(dt) {
    elapsedGameTime += dt;

    const isHighSpeedMode = currentMode === 'superspeed' || currentMode === 'hardest';
    const modeSpeedMultiplier = currentMode === 'superspeed' ? 2.2 : currentMode === 'hardest' ? 1.8 : 1.0;
    const modeAccelMultiplier = currentMode === 'superspeed' ? 1.8 : currentMode === 'hardest' ? 1.4 : 1.0;

    const difficultySpeedMultiplier = currentMode === 'hardest'
        ? CONFIG.easy.speedMultiplier
        : CONFIG[currentDiff].speedMultiplier;
    const gearInfo = SPEED_GEARS[currentGear];
    let currentAccel = gearInfo.accel * modeAccelMultiplier * difficultySpeedMultiplier;
    let currentMaxSpeed = dronePhysics.baseMaxSpeed * gearInfo.multiplier * modeSpeedMultiplier * difficultySpeedMultiplier;

    const inputVec = new THREE.Vector3();
    if (currentMode === 'hardest') {
        droneHeading += (Number(keys.RotateLeft) - Number(keys.RotateRight)) * 1.8 * dt;
        playerDroneGroup.rotation.y = droneHeading;

        const forwardX = Math.sin(droneHeading);
        const forwardZ = Math.cos(droneHeading);
        const forwardInput = Number(keys.Forward) - Number(keys.Backward);
        const lateralInput = Number(keys.Left) - Number(keys.Right);
        inputVec.x = forwardX * forwardInput * 1.2 + Math.cos(droneHeading) * lateralInput * 1.8;
        inputVec.z = forwardZ * forwardInput * 1.2 - forwardX * lateralInput * 1.8;
    } else {
        inputVec.z = 1.2;
        if (keys.Left) inputVec.x += 1.8;
        if (keys.Right) inputVec.x -= 1.8;
    }
    if (keys.Up) inputVec.y += 1.6;
    if (keys.Down) inputVec.y -= 1.6;
    if (currentMode === 'hardest') inputVec.multiplyScalar(0.85);

    dronePhysics.vel.x += inputVec.x * currentAccel * dt;
    dronePhysics.vel.y += inputVec.y * currentAccel * dt;
    dronePhysics.vel.z += inputVec.z * currentAccel * dt;

    const currentDrag = currentMode === 'hardest'
        ? Math.exp(-3.5 * dt)
        : isHighSpeedMode ? 0.95 : dronePhysics.drag;
    dronePhysics.vel.multiplyScalar(currentDrag);
    dronePhysics.vel.clampLength(0, currentMaxSpeed);

    const previousX = dronePhysics.pos.x;
    const previousY = dronePhysics.pos.y;
    const previousZ = dronePhysics.pos.z;
    dronePhysics.pos.addScaledVector(dronePhysics.vel, dt);
    dronePhysics.pos.x = Math.max(-28, Math.min(28, dronePhysics.pos.x));
    dronePhysics.pos.y = Math.max(1.2, Math.min(22, dronePhysics.pos.y));

    playerDroneGroup.position.copy(dronePhysics.pos);
    if (currentMode !== 'hardest') {
        playerDroneGroup.rotation.z = THREE.MathUtils.lerp(playerDroneGroup.rotation.z, -dronePhysics.vel.x * 0.008, 0.2);
    } else {
        playerDroneGroup.rotation.z = 0;
    }

    const speedKmh = Math.floor(dronePhysics.vel.length() * 3.6);
    audio.updateEngine(speedKmh, true);

    if (isHighSpeedMode) {
        const targetFov = 72 + Math.min(38, speedKmh * 0.035);
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
        camera.updateProjectionMatrix();

        if (particleSystem) {
            particleSystem.rotation.y += dt * 0.002;
        }
    } else {
        const targetFov = 72 + Math.min(20, speedKmh * 0.02);
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
        camera.updateProjectionMatrix();
    }

    rings.forEach(ring => {
        ring.collisionCooldown = Math.max(0, ring.collisionCooldown - dt);
        if (!ring.passed && previousZ <= ring.pos.z && dronePhysics.pos.z >= ring.pos.z &&
            previousZ !== dronePhysics.pos.z) {
            const crossingRatio = (ring.pos.z - previousZ) / (dronePhysics.pos.z - previousZ);
            const crossingX = previousX + (dronePhysics.pos.x - previousX) * crossingRatio;
            const crossingY = previousY + (dronePhysics.pos.y - previousY) * crossingRatio;
            const ringOpeningRadius = ring.radius - ring.tubeRadius - dronePhysics.radius * 0.75;

            if (Math.hypot(crossingX - ring.pos.x, crossingY - ring.pos.y) <= ringOpeningRadius) {
                ring.passed = true;
                ringsPassedCount++;
                score += isHighSpeedMode ? 500 : 350;
                ring.material.color.setHex(0xff2020);
                ring.material.emissive.setHex(0xff2020);
                ring.material.emissiveIntensity = 1.2;
                audio.playRingPass();
            }
        }

        const offsetX = dronePhysics.pos.x - ring.pos.x;
        const offsetY = dronePhysics.pos.y - ring.pos.y;
        const radialDistance = Math.hypot(offsetX, offsetY);
        const closestPoint = new THREE.Vector3(
            ring.pos.x + (radialDistance > 0 ? offsetX / radialDistance : 1) * ring.radius,
            ring.pos.y + (radialDistance > 0 ? offsetY / radialDistance : 0) * ring.radius,
            ring.pos.z
        );
        const ringEdgeDistance = dronePhysics.pos.distanceTo(closestPoint);

        const ringCollisionDistance = (dronePhysics.radius + ring.tubeRadius) * 1.05;
        if (ringEdgeDistance < ringCollisionDistance && ring.collisionCooldown === 0) {
            const pushDirection = new THREE.Vector3().subVectors(dronePhysics.pos, closestPoint);
            if (pushDirection.lengthSq() === 0) pushDirection.set(0, 0, 1);
            pushDirection.normalize();

            const forwardDirection = currentMode === 'hardest'
                ? new THREE.Vector3(Math.sin(droneHeading), 0, Math.cos(droneHeading))
                : new THREE.Vector3(0, 0, 1);
            const forwardSpeed = dronePhysics.vel.dot(forwardDirection);
            dronePhysics.pos.addScaledVector(pushDirection, 0.2);
            dronePhysics.vel.addScaledVector(pushDirection, 8);
            dronePhysics.vel.addScaledVector(forwardDirection, -forwardSpeed - 18);
            playerDroneGroup.position.copy(dronePhysics.pos);
            ring.collisionCooldown = 0.75;

            shield = Math.max(0, shield - 5);
            triggerDamageVignette();
            audio.playCrash();
            if (shield === 0) {
                endGame(false, "DRONE CRASHED!");
                return;
            }
        }

    });

    defenders.forEach(def => {
        def.collisionCooldown = Math.max(0, def.collisionCooldown - dt);
        def.mesh.position.addScaledVector(def.knockbackVelocity, dt);
        def.knockbackVelocity.multiplyScalar(Math.exp(-3 * dt));

        def.directionChangeIn -= dt;
        if (def.directionChangeIn <= 0) {
            def.targetX = THREE.MathUtils.clamp(def.anchorX + THREE.MathUtils.randFloat(-5, 5), -24, 24);
            def.targetY = THREE.MathUtils.clamp(def.anchorY + THREE.MathUtils.randFloat(-4, 4), 2, 20);
            def.targetZ = def.anchorZ + THREE.MathUtils.randFloat(-2.5, 2.5);
            def.directionChangeIn = THREE.MathUtils.randFloat(
                currentMode === 'superspeed' || currentMode === 'hardest' ? 0.45 : 0.7,
                currentMode === 'superspeed' || currentMode === 'hardest' ? 1.25 : 1.8
            );
        }

        const movementSmoothing = 1 - Math.exp(-2.1 * dt);
        def.mesh.position.x = THREE.MathUtils.lerp(def.mesh.position.x, def.targetX, movementSmoothing);
        def.mesh.position.y = THREE.MathUtils.lerp(def.mesh.position.y, def.targetY, movementSmoothing);
        def.mesh.position.z = THREE.MathUtils.lerp(def.mesh.position.z, def.targetZ, movementSmoothing);
        const collisionDistance = dronePhysics.radius + def.radius;
        const distanceToDefender = dronePhysics.pos.distanceTo(def.mesh.position);
        if (distanceToDefender < collisionDistance && def.collisionCooldown === 0) {
            const pushDirection = new THREE.Vector3().subVectors(def.mesh.position, dronePhysics.pos);
            if (pushDirection.lengthSq() === 0) pushDirection.set(0, 1, 0);
            pushDirection.normalize();

            const overlap = collisionDistance - distanceToDefender;
            def.mesh.position.addScaledVector(pushDirection, overlap * 0.75);
            dronePhysics.pos.addScaledVector(pushDirection, -(overlap * 0.25 + 1));
            def.knockbackVelocity.addScaledVector(pushDirection, 60);
            dronePhysics.vel.addScaledVector(pushDirection, -36);
            if (currentMode === 'hardest') {
                const impactSide = pushDirection.x * Math.cos(droneHeading) -
                    pushDirection.z * Math.sin(droneHeading);
                const turnDirection = Math.abs(impactSide) > 0.1
                    ? -Math.sign(impactSide)
                    : Math.random() < 0.5 ? -1 : 1;
                droneHeading += turnDirection * 0.35;
                playerDroneGroup.rotation.y = droneHeading;
            }
            playerDroneGroup.position.copy(dronePhysics.pos);
            def.collisionCooldown = 0.5;

            shield -= 7;
            triggerDamageVignette();
            audio.playCrash();
            if (shield <= 0) {
                shield = 0;
                endGame(false, "DRONE CRASHED!");
                return;
            }
        }
    });

    if (goalRingMesh) {
        const goalZ = getTrackLength() + 30;
        if (previousZ < goalZ && dronePhysics.pos.z >= goalZ) {
            const crossingRatio = (goalZ - previousZ) / (dronePhysics.pos.z - previousZ);
            const crossingX = previousX + (dronePhysics.pos.x - previousX) * crossingRatio;
            const crossingY = previousY + (dronePhysics.pos.y - previousY) * crossingRatio;
            const goalCenter = goalRingMesh.position;
            const openingRadius = GOAL_RING_RADIUS - GOAL_RING_TUBE_RADIUS - dronePhysics.radius;
            const passedThroughGoal = Math.hypot(
                crossingX - goalCenter.x,
                crossingY - goalCenter.y
            ) < openingRadius;

            if (passedThroughGoal) {
                endGame(true, "GOAL SUCCESS! STRIKER GOAL CROSSED!");
            } else {
                endGame(false, "GOAL MISSED! STRIKER GOAL NOT CROSSED!", true);
            }
            return;
        }
    }

    updateHUD(speedKmh);
}

function setGameMode(mode) {
    currentMode = mode;
    if (mode !== 'hardest' && currentGear === 'GEAR4') {
        currentGear = 'GEAR3';
    }
    if (mode === 'hardest') {
        setDifficulty('hard');
    }
    updateGearUI();
    document.getElementById('difficulty-selector').classList.toggle('hidden', mode === 'hardest');
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('bg-cyan-500/30', 'border-cyan-400', 'text-white');
        btn.classList.add('bg-gray-800/60', 'border-gray-700', 'text-gray-400');
    });
    const activeBtn = document.getElementById(`mode-${mode}`);
    activeBtn.classList.remove('bg-gray-800/60', 'border-gray-700', 'text-gray-400');
    activeBtn.classList.add('bg-cyan-500/30', 'border-cyan-400', 'text-white');
    document.getElementById('standard-key-guide').classList.toggle('hidden', mode === 'hardest');
    document.getElementById('hardest-key-guide').classList.toggle('hidden', mode !== 'hardest');
    document.getElementById('mobile-rotation-controls').style.display = mode === 'hardest' ? 'flex' : 'none';

    const hudIndicator = document.getElementById('hud-mode-indicator');
    if (hudIndicator) {
        hudIndicator.innerText = mode === 'superspeed'
            ? '上級者向け'
            : mode === 'beginners' ? '初心者向け'
                : mode === 'hardest' ? '最難関コース' : '中級者向け';
        hudIndicator.className = mode === 'superspeed'
            ? 'text-pink-400 font-orbitron'
            : mode === 'beginners' ? 'text-emerald-300 font-orbitron'
                : mode === 'hardest' ? 'text-red-300 font-orbitron' : 'text-cyan-300 font-orbitron';
    }

    loadHighScores();
}

function setDifficulty(diff) {
    if (currentMode === 'hardest' && diff !== 'hard') return;
    currentDiff = diff;
    document.querySelectorAll('.diff-btn').forEach(btn => {
        btn.classList.remove('bg-cyan-500/30', 'border-cyan-400', 'text-white');
        btn.classList.add('bg-gray-800/60', 'border-gray-700', 'text-gray-400');
    });
    const activeBtn = document.getElementById(`diff-${diff}`);
    activeBtn.classList.remove('bg-gray-800/60', 'border-gray-700', 'text-gray-400');
    activeBtn.classList.add('bg-cyan-500/30', 'border-cyan-400', 'text-white');

    loadHighScores();
}

function startGame() {
    audio.init();
    const ringCount = CONFIG[currentDiff].ringCount +
        (currentMode === 'superspeed' || currentMode === 'hardest' ? 7 : 0);
    const config = {
        ...CONFIG[currentDiff],
        ringCount,
        defenderCount: currentMode === 'beginners' ? 0 : ringCount,
        trackLength: getTrackLength()
    };
    gameState = 'COUNTDOWN';
    countdownRemaining = 3;
    score = 0;
    shield = 100;
    elapsedGameTime = 0;
    ringsPassedCount = 0;
    pendingRankingScore = null;
    rankingEntrySubmitted = false;
    currentGear = 'GEAR2';
    updateGearUI();

    dronePhysics.pos.set(0, 5, -10);
    dronePhysics.vel.set(0, 0, 0);
    droneHeading = 0;
    playerDroneGroup.rotation.set(0, 0, 0);
    Object.keys(keys).forEach(key => { keys[key] = false; });

    buildTrack(config);

    document.getElementById('menu-overlay').classList.add('hidden');
    document.getElementById('result-overlay').classList.add('hidden');
    document.getElementById('hud-layer').classList.remove('hidden');
    document.getElementById('countdown-number').innerText = '3';
    document.getElementById('countdown-overlay').classList.remove('hidden');
    document.getElementById('countdown-overlay').classList.add('flex');
}

function updateHUD(speedKmh) {
    document.getElementById('hud-shield-bar').style.width = `${shield}%`;
    document.getElementById('hud-shield-num').innerText = `${Math.ceil(shield)}%`;
    document.getElementById('hud-timer').innerText = elapsedGameTime.toFixed(1);
    document.getElementById('hud-score').innerText = score;
    document.getElementById('hud-speed').innerText = speedKmh;
    document.getElementById('hud-alt').innerText = `${dronePhysics.pos.y.toFixed(1)}m`;

    const goalZ = getTrackLength() + 30;
    const progress = Math.max(0, Math.min(100, ((dronePhysics.pos.z + 10) / (goalZ + 10)) * 100));
    document.getElementById('hud-progress-bar').style.width = `${progress}%`;

    const distToGoal = Math.max(0, Math.floor(goalZ - dronePhysics.pos.z));
    document.getElementById('hud-dist').innerText = `${distToGoal}m`;
}

function endGame(isVictory, message, allowRanking = false) {
    audio.updateEngine(0, false);
    gameState = isVictory ? 'VICTORY' : 'GAMEOVER';
    document.getElementById('hud-layer').classList.add('hidden');

    const resOverlay = document.getElementById('result-overlay');
    const resTitle = document.getElementById('result-title');
    const resBadge = document.getElementById('result-badge');
    const resDesc = document.getElementById('result-desc');
    const canRank = currentMode !== 'hardest' && (isVictory || allowRanking);
    const ringBonus = ringsPassedCount * 300;
    const timeBonus = Math.floor(30000 / Math.max(elapsedGameTime, 1));
    const totalScore = score + ringBonus + timeBonus;

    if (isVictory) {
        audio.playVictory();
        resBadge.className = "inline-block px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 bg-emerald-500/20 border border-emerald-400 text-emerald-300";
        resBadge.innerText = "VICTORY";
        resTitle.className = "text-3xl font-black font-orbitron mb-2 text-emerald-400 neon-text-cyan";
        resTitle.innerText = "GOAL SUCCESS!";

        if (currentMode !== 'hardest') {
            pendingRankingScore = totalScore;
            rankingEntrySubmitted = false;
        }

        document.getElementById('res-time').innerText = `${elapsedGameTime.toFixed(2)}s`;
        document.getElementById('res-rings').innerText = `+${ringBonus} pts (${ringsPassedCount})`;
        document.getElementById('res-time-bonus').innerText = `+${timeBonus} pts`;
        document.getElementById('res-score').innerText = totalScore;

        saveHighScore(totalScore, elapsedGameTime);
    } else {
        audio.playCrash();
        resBadge.className = "inline-block px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 bg-pink-500/20 border border-pink-400 text-pink-300";
        resBadge.innerText = "FAILED";
        resTitle.className = "text-3xl font-black font-orbitron mb-2 text-pink-500 neon-text-pink";
        resTitle.innerText = "MISSION FAILED";

        document.getElementById('res-time').innerText = canRank ? `${elapsedGameTime.toFixed(2)}s` : "--";
        document.getElementById('res-rings').innerText = canRank
            ? `+${ringBonus} pts (${ringsPassedCount})`
            : `${ringsPassedCount}`;
        document.getElementById('res-time-bonus').innerText = canRank ? `+${timeBonus} pts` : "+0 pts";
        document.getElementById('res-score').innerText = canRank ? totalScore : score;
        if (canRank) {
            pendingRankingScore = totalScore;
            rankingEntrySubmitted = false;
        }
    }

    if (canRank) {
        document.getElementById('ranking-entry-form').classList.remove('hidden');
        document.getElementById('ranking-nickname').value = '';
        document.getElementById('ranking-entry-message').innerText = '';
        document.getElementById('ranking-submit').disabled = false;
    } else {
        document.getElementById('ranking-entry-form').classList.add('hidden');
    }

    resDesc.innerText = message;
    resOverlay.classList.remove('hidden');
}

function retireRace() {
    if (gameState !== 'PLAYING' && gameState !== 'COUNTDOWN') return;
    if (!window.confirm('レースをリタイアしますか？今回の記録は保存されません。')) return;

    audio.updateEngine(0, false);
    gameState = 'GAMEOVER';
    pendingRankingScore = null;
    rankingEntrySubmitted = false;
    Object.keys(keys).forEach(key => { keys[key] = false; });
    document.getElementById('hud-layer').classList.add('hidden');
    document.getElementById('countdown-overlay').classList.add('hidden');
    document.getElementById('countdown-overlay').classList.remove('flex');
    document.getElementById('ranking-entry-form').classList.add('hidden');

    document.getElementById('result-badge').className = 'inline-block px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 bg-gray-500/20 border border-gray-400 text-gray-300';
    document.getElementById('result-badge').innerText = 'リタイア';
    document.getElementById('result-title').className = 'text-3xl font-black font-orbitron mb-2 text-gray-300';
    document.getElementById('result-title').innerText = 'レースを終了しました';
    document.getElementById('result-desc').innerText = '今回のスコアとタイムは記録されません。';
    document.getElementById('res-time').innerText = `${elapsedGameTime.toFixed(2)}秒`;
    document.getElementById('res-rings').innerText = `${ringsPassedCount}個`;
    document.getElementById('res-time-bonus').innerText = '+0 pts';
    document.getElementById('res-score').innerText = score;
    document.getElementById('result-overlay').classList.remove('hidden');
}

function resetToMenu() {
    gameState = 'MENU';
    document.getElementById('result-overlay').classList.add('hidden');
    document.getElementById('ranking-overlay').classList.add('hidden');
    document.getElementById('countdown-overlay').classList.add('hidden');
    document.getElementById('countdown-overlay').classList.remove('flex');
    document.getElementById('menu-overlay').classList.remove('hidden');
    loadHighScores();
}

function getRankingEntries() {
    const savedEntries = localStorage.getItem(RANKING_STORAGE_KEY);
    if (!savedEntries) return [];

    const entries = JSON.parse(savedEntries);
    if (!Array.isArray(entries) || entries.some(entry =>
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.nickname !== 'string' ||
        !Number.isFinite(entry.score) ||
        !Number.isFinite(entry.time) ||
        typeof entry.difficulty !== 'string' ||
        typeof entry.mode !== 'string'
    )) {
        throw new Error('Saved ranking data has an invalid format.');
    }
    return entries;
}

function openRanking() {
    document.getElementById('ranking-search').value = '';
    searchRanking();
    document.getElementById('ranking-overlay').classList.remove('hidden');
}

function searchRanking() {
    const rankingList = document.getElementById('ranking-list');
    rankingList.innerHTML = '';
    const entries = getRankingEntries()
        .sort((a, b) => b.score - a.score || a.time - b.time);
    const query = document.getElementById('ranking-search').value.trim().toLocaleLowerCase();
    const matchingEntries = entries
        .map((entry, index) => ({ entry, rank: index + 1 }))
        .filter(({ entry }) => entry.nickname.toLocaleLowerCase().includes(query));

    if (matchingEntries.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'text-center text-sm text-gray-400 py-6';
        emptyMessage.innerText = entries.length === 0
            ? 'まだランキング記録がありません。'
            : '該当するニックネームがありません。';
        rankingList.appendChild(emptyMessage);
    } else {
        matchingEntries.forEach(({ entry, rank: position }) => {
            const row = document.createElement('div');
            row.className = 'grid grid-cols-[2rem_minmax(0,1fr)_7rem] items-center gap-3 rounded-xl bg-slate-900/90 border border-gray-800 p-3';

            const rank = document.createElement('span');
            rank.className = 'text-left tabular-nums font-black text-cyan-300';
            rank.innerText = `${position}`;

            const info = document.createElement('div');
            info.className = 'min-w-0 flex-1';
            const nickname = document.createElement('div');
            nickname.className = 'truncate font-bold text-white';
            nickname.innerText = entry.nickname;
            const details = document.createElement('div');
            details.className = 'text-[10px] text-gray-400';
            const modeName = entry.mode === 'superspeed'
                ? '上級者向け'
                : entry.mode === 'beginners' ? '初心者向け'
                    : entry.mode === 'hardest' ? '最難関コース' : '中級者向け';
            const difficultyName = { easy: '簡単', medium: '普通', hard: '難関' }[entry.difficulty] || entry.difficulty;
            details.innerText = `${difficultyName} · ${modeName} · ${entry.time.toFixed(2)}秒`;
            info.append(nickname, details);

            const points = document.createElement('span');
            points.className = 'text-right tabular-nums whitespace-nowrap font-black text-amber-300';
            points.innerText = `${entry.score.toLocaleString()} pts`;

            row.append(rank, info, points);
            rankingList.appendChild(row);
        });
    }
}

function closeRanking() {
    document.getElementById('ranking-overlay').classList.add('hidden');
}

function submitRankingScore(event) {
    event.preventDefault();
    if (pendingRankingScore === null || rankingEntrySubmitted) return;

    const nicknameInput = document.getElementById('ranking-nickname');
    const nickname = nicknameInput.value.trim();
    if (!nickname) {
        nicknameInput.focus();
        return;
    }

    const entries = getRankingEntries();
    const newEntry = {
        nickname,
        score: pendingRankingScore,
        time: elapsedGameTime,
        difficulty: currentDiff,
        mode: currentMode
    };
    const normalizedNickname = nickname.toLocaleLowerCase();
    const samePlayerEntries = entries.filter(entry =>
        entry.nickname.trim().toLocaleLowerCase() === normalizedNickname
    );
    const bestEntry = samePlayerEntries.reduce((best, entry) =>
        !best || entry.score > best.score || (entry.score === best.score && entry.time < best.time)
            ? entry
            : best,
    null);
    const playerBest = bestEntry &&
        (bestEntry.score > newEntry.score || (bestEntry.score === newEntry.score && bestEntry.time <= newEntry.time))
        ? bestEntry
        : newEntry;
    const updatedEntries = entries.filter(entry =>
        entry.nickname.trim().toLocaleLowerCase() !== normalizedNickname
    );
    updatedEntries.push(playerBest);
    updatedEntries.sort((a, b) => b.score - a.score || a.time - b.time);
    localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(updatedEntries));

    rankingEntrySubmitted = true;
    document.getElementById('ranking-submit').disabled = true;
    document.getElementById('ranking-entry-message').innerText = 'ランキングに登録しました。';
}

function saveHighScore(newScore, newTime) {
    const keyScore = `ds_score_${currentDiff}_${currentMode}`;
    const keyTime = `ds_time_${currentDiff}_${currentMode}`;

    const oldScore = parseInt(localStorage.getItem(keyScore) || '0');
    const oldTime = parseFloat(localStorage.getItem(keyTime) || '9999');

    if (newScore > oldScore) localStorage.setItem(keyScore, newScore.toString());
    if (newTime < oldTime) localStorage.setItem(keyTime, newTime.toFixed(2));
}

function loadHighScores() {
    const keyScore = `ds_score_${currentDiff}_${currentMode}`;
    const keyTime = `ds_time_${currentDiff}_${currentMode}`;

    const savedScore = localStorage.getItem(keyScore) || '0';
    const savedTime = localStorage.getItem(keyTime);

    document.getElementById('high-score').innerText = savedScore;
    document.getElementById('best-time').innerText = savedTime ? `${savedTime}s` : '--';
}

function resetGameRecords() {
    const shouldReset = window.confirm('ランキング、ニックネーム、ベストスコア、ベストタイムをすべてリセットします。この操作は取り消せません。');
    if (!shouldReset) return;

    Object.keys(localStorage)
        .filter(key => key.startsWith('ds_score_') || key.startsWith('ds_time_'))
        .forEach(key => localStorage.removeItem(key));
    localStorage.removeItem(RANKING_STORAGE_KEY);
    localStorage.removeItem(LEGACY_RANKING_NICKNAME_KEY);
    loadHighScores();
}

function resetAllRecordsOnce() {
    const resetKey = 'ds_reset_all_records_v4';
    if (localStorage.getItem(resetKey)) return;

    Object.keys(localStorage)
        .filter(key => key.startsWith('ds_score_') || key.startsWith('ds_time_'))
        .forEach(key => localStorage.removeItem(key));
    localStorage.removeItem(RANKING_STORAGE_KEY);
    localStorage.setItem(resetKey, '1');
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

window.onload = function () {
    initThree();
    setupControls();
    localStorage.removeItem(LEGACY_RANKING_NICKNAME_KEY);
    resetAllRecordsOnce();
    loadHighScores();
    animate();
};