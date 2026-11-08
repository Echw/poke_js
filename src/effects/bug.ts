import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { makeRibbons } from './ribbonGeometry';
import { makeFireflyRoute, sampleFirefly } from './bugMotion';
import { bugRibbonVertex, bugRibbonFragment, fireflyVertex, fireflyFragment, makeWingGeometry, makeWingMaterial } from './bugMaterial';
import type { PokemonRevealEffect } from './types';
/** Compact insect aura. Playback, time and rendering belong to the scene controller. */
export class BugEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xd9ee40);
    readonly fillLightPosition = new THREE.Vector3(0, 0.02, 0.38);
    private readonly transformation: CardTransformation;
    private readonly state = { ribbons: 0, swarm: 0, wings: 0 };
    private readonly ribbons: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly flies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly wings: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly routes;
    private readonly dummy = new THREE.Object3D();
    private readonly point = new THREE.Vector3();
    private finished = false;
    private active = false;
    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'BugEffect';
        this.transformation = new CardTransformation(card, 'bug', mobile);
        this.root.add(this.transformation.root);
        const ribbonMaterial = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uMorph: { value: 0 }, uOpacity: { value: 0 } },
            vertexShader: bugRibbonVertex, fragmentShader: bugRibbonFragment,
            transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
            depthTest: true, depthWrite: false, forceSinglePass: true, toneMapped: false,
        });
        this.ribbons = new THREE.Mesh(makeRibbons(mobile ? 3 : 4, 1, 128, 8), ribbonMaterial);
        this.ribbons.name = 'BugOrbits';
        this.root.add(this.ribbons);
        this.routes = Array.from({ length: mobile ? 24 : 36 }, (_, i) => makeFireflyRoute(i, mobile));
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.routes.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(this.routes.map((_, i) => 0.085 + i % 4 * 0.009), 1));
        geometry.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(this.routes.length), 1).setUsage(THREE.DynamicDrawUsage));
        this.flies = new THREE.Points(geometry, new THREE.ShaderMaterial({
            uniforms: { uViewportHeight: { value: 800 } }, vertexShader: fireflyVertex, fragmentShader: fireflyFragment,
            transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false,
        }));
        this.flies.name = 'BugFireflies';
        this.flies.frustumCulled = false;
        this.root.add(this.flies);
        this.wings = new THREE.InstancedMesh(makeWingGeometry(), makeWingMaterial(), mobile ? 2 : 3);
        this.wings.name = 'BugWings';
        this.wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.wings.frustumCulled = false;
        this.root.add(this.wings);
        this.root.traverse(object => { object.renderOrder = 2; });
        this.root.visible = false;
    }
    get fillLightIntensity(): number {
        return this.active && !this.finished ? this.transformation.state.core * this.transformation.state.fade * (1 - this.transformation.state.cardImage) * 1.3 : 0;
    }
    setActive(active: boolean): void {
        this.active = active;
        this.root.visible = active;
        this.transformation.setActive(active);
    }
    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { swarm: 0.22, ribbons: 0.18, duration: 0.4, ease: 'power2.out' }, 0);
        timeline.to(this.state, { swarm: 0.65, ribbons: 0.60, wings: 0.65, duration: 0.4, ease: 'power2.out' }, 0.4);
        timeline.to(this.state, { swarm: 1, ribbons: 1, wings: 1, duration: 0.40, ease: 'power2.out' }, 0.8);
    }
    private updateWings(time: number, opacity: number): void {
        this.wings.material.uniforms.uOpacity.value = opacity;
        this.wings.material.uniforms.uTime.value = time;
        for (let i = 0; i < this.wings.count; i++) {
            const phase = i * 2.4, side = i % 2 === 0 ? -1 : 1;
            this.dummy.position.set(side * (0.52 + i * 0.055) + 0.035 * Math.sin(time * 1.7 + phase), 0.24 + i * 0.22 + 0.06 * Math.sin(time * 1.5 + phase), 0.42 + 0.22 * Math.sin(phase + time * 0.6));
            this.dummy.rotation.set(0.25 * Math.sin(time * 2.1 + phase), 0.30 * Math.sin(time * 1.6 + phase), side * 0.32 + 0.20 * Math.sin(time * 1.9 + phase));
            this.dummy.scale.setScalar(0.80 + i * 0.10);
            this.dummy.updateMatrix();
            this.wings.setMatrixAt(i, this.dummy.matrix);
        }
        this.wings.instanceMatrix.needsUpdate = true;
    }
    update(time: number, viewportHeight: number): void {
        this.transformation.update(time);
        const shared = this.transformation.state;
        const fade = this.finished ? 0 : shared.fade;
        const aura = fade * (1 - shared.cardImage);
        this.ribbons.material.uniforms.uTime.value = time;
        this.ribbons.material.uniforms.uMorph.value = shared.morph;
        this.ribbons.material.uniforms.uOpacity.value = this.state.ribbons * aura;
        this.ribbons.visible = aura > 0.001;
        this.wings.visible = aura * this.state.wings > 0.001;
        if (this.wings.visible)
            this.updateWings(time, aura * this.state.wings);
        const positions = this.flies.geometry.getAttribute('position');
        const lights = this.flies.geometry.getAttribute('aLight');
        for (let i = 0; i < this.routes.length; i++) {
            sampleFirefly(this.routes[i], time, this.point);
            positions.setXYZ(i, this.point.x, this.point.y, this.point.z);
            const pulse = THREE.MathUtils.smoothstep(Math.sin(time * (3.0 + i % 4 * 0.67) + i * 2.4), -0.65, 0.70);
            const arrival = THREE.MathUtils.smoothstep(time, 0.03 + i * 0.018, 0.28 + i * 0.018);
            const exit = i < 3 ? fade : fade * (1 - shared.cardImage);
            lights.setX(i, this.state.swarm * arrival * exit * pulse * (0.8 + i % 3 * 0.13));
        }
        positions.needsUpdate = lights.needsUpdate = true;
        this.flies.material.uniforms.uViewportHeight.value = viewportHeight;
        this.flies.visible = fade > 0.001;
    }
    reset(): void {
        this.finished = false;
        Object.assign(this.state, { ribbons: 0, swarm: 0, wings: 0 });
        this.transformation.reset();
        this.transformation.setActive(this.active);
        this.update(0, 800);
    }
    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.ribbons.visible = this.flies.visible = this.wings.visible = false;
    }
    getDebugInfo() {
        return { flies: this.routes.length, wings: this.wings.count,
            bands: this.ribbons.geometry.getAttribute('aRibbon').getX(this.ribbons.geometry.getAttribute('aRibbon').count - 1) + 1,
            lights: Array.from(this.flies.geometry.getAttribute('aLight').array), finished: this.finished };
    }
    dispose(): void {
        this.setActive(false);
        this.root.removeFromParent();
        this.transformation.dispose();
        for (const mesh of [this.ribbons, this.flies, this.wings]) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.wings.dispose();
    }
}
