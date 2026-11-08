import * as THREE from 'three';

/** Shared with the host's fast opening tween. */
export const SMOKE_OPENING = { duration: 0.8, lidDegrees: 45, bodyDegrees: 4 } as const;

export class SmokeBoundarySampler {
    readonly worldToBowl = new THREE.Matrix4();
    readonly bowlToWorld = new THREE.Matrix4();
    readonly worldToLid = new THREE.Matrix4();
    readonly bowlToPrevious = new THREE.Matrix4();
    readonly lidToPrevious = new THREE.Matrix4();
    opening = 0;
    private readonly rootPosition = new THREE.Vector3();
    private readonly rootScale = new THREE.Vector3();
    private readonly rootQuaternion = new THREE.Quaternion();
    private readonly parentRelative = new THREE.Matrix4();
    private readonly lidClosedWorld = new THREE.Matrix4();
    private readonly rootInitialInverse = new THREE.Matrix4();
    private readonly lidPosition: THREE.Vector3;
    private readonly lidScale: THREE.Vector3;
    private readonly lidEuler: THREE.Euler;
    private readonly q = new THREE.Quaternion();
    private readonly axis = new THREE.Vector3(1, 0, 0);
    private readonly local = new THREE.Matrix4();
    private readonly currentLid = new THREE.Matrix4();
    private readonly previousLid = new THREE.Matrix4();
    private readonly previousBowl = new THREE.Matrix4();
    private readonly inverseLid = new THREE.Matrix4();
    private readonly angles = new THREE.Euler();

    constructor(root: THREE.Object3D, lid: THREE.Object3D) {
        root.updateWorldMatrix(true, true);
        root.matrixWorld.decompose(this.rootPosition, this.rootQuaternion, this.rootScale);
        this.rootInitialInverse.copy(root.matrixWorld).invert();
        this.parentRelative.multiplyMatrices(this.rootInitialInverse, lid.parent!.matrixWorld);
        this.lidClosedWorld.copy(lid.matrixWorld);
        this.lidPosition = lid.position.clone();
        this.lidScale = lid.scale.clone();
        this.lidEuler = lid.rotation.clone();
    }

    /** Pure pose sampling; no scene nodes or GSAP time are changed. */
    sample(time: number, dt: number): void {
        this.pose(Math.max(0, time - dt), this.previousBowl, this.previousLid);
        this.opening = this.pose(time, this.bowlToWorld, this.currentLid);
        this.worldToBowl.copy(this.bowlToWorld).invert();
        this.inverseLid.copy(this.currentLid).invert();
        this.worldToLid.copy(this.rootInitialInverse).multiply(this.lidClosedWorld).multiply(this.inverseLid);
        this.bowlToPrevious.multiplyMatrices(this.previousBowl, this.worldToBowl);
        this.lidToPrevious.multiplyMatrices(this.previousLid, this.inverseLid);
    }

    private pose(time: number, bowl: THREE.Matrix4, lid: THREE.Matrix4): number {
        const t = THREE.MathUtils.clamp(time / SMOKE_OPENING.duration, 0, 1);
        const ease = 1 - (1 - t) * (1 - t);
        this.q
            .setFromAxisAngle(this.axis, THREE.MathUtils.degToRad(SMOKE_OPENING.bodyDegrees) * ease)
            .premultiply(this.rootQuaternion);
        bowl.compose(this.rootPosition, this.q, this.rootScale);
        this.angles.copy(this.lidEuler);
        this.angles.x -= THREE.MathUtils.degToRad(SMOKE_OPENING.lidDegrees) * ease;
        this.q.setFromEuler(this.angles);
        this.local.compose(this.lidPosition, this.q, this.lidScale);
        lid.copy(bowl).multiply(this.parentRelative).multiply(this.local);
        return ease;
    }
}
