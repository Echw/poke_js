import * as THREE from 'three';

export type NormalLayer = 'stream' | 'source' | 'orbit' | 'aura' | 'mote' | 'pool' | 'dust' | 'star';

// Ball-local path shared by the ribbons and their traveling star accents.
const field = /* glsl */ `
    uniform float uTime, uFlowTime, uGrowth, uMorph, uImage;
    vec3 normalPoint(float t, float band) {
        float angle=t*9.424778-0.65+0.24*sin(t*6.283185)+band*0.56;
        float radius=0.66*smoothstep(0.0,0.21,t)*(0.91+0.14*sin(t*5.0-0.5));
        radius*=band<0.5?1.0:0.92;
        float lift=t*0.94+0.035*sin(angle)*sin(t*3.141593);
        return vec3(sin(angle)*radius,-0.065+lift,0.46+cos(angle)*radius*0.46)
            +sin(t*3.141593)*vec3(0.010*sin(t*11.0-uTime*0.6+band),0.0,0.0);
    }
    float packetPosition(float birth) {
        return 0.045+(uFlowTime-birth)*0.38;
    }
    float packetLight(float t) {
        float light=0.0;
        for(int i=0;i<4;i++) {
            float birth=0.12+float(i)*0.61;
            float age=uFlowTime-birth;
            float life=smoothstep(0.0,0.22,age)*(1.0-smoothstep(1.20,1.65,age));
            light+=exp(-pow((t-packetPosition(birth))*40.0,2.0))*life;
        }
        return light;
    }
    float envelope(float age) {
        return smoothstep(0.0, 0.23, age)*(1.0-smoothstep(0.48, 1.0, age));
    }
    // Grass's low sweep, kept separate from the approved main spiral.
    vec3 orbitPoint(float t, float strand) {
        float angle=t*5.55+uTime*0.65-1.4+strand*0.21;
        float radius=(0.25+0.77*smoothstep(0.0,0.34,t))*(1.0+0.025*sin(t*17.0-uTime));
        return vec3(cos(angle)*radius,0.24+0.18*sin(angle+0.4)+t*0.16,
            0.52+sin(angle)*radius*0.38);
    }
`;

const vertex = /* glsl */ `
    ${field}
    uniform mat4 uEffectToCard, uViewToCard;
    varying vec3 vCardPosition;
    varying vec2 vUv;
    varying float vLife, vT, vBand, vStrand;
    #if defined(STREAM) || defined(SOURCE) || defined(ORBIT)
    attribute float aT, aSide, aRibbon, aStrand;
    #elif defined(AURA)
    attribute float aAura;
    #elif defined(STAR) || defined(DUST) || defined(MOTE)
    attribute vec4 aSeed;
    #ifdef STAR
    attribute float aTrail;
    #endif
    #endif
    void main() {
        vec3 p=position;
        vUv=uv; vLife=1.0; vT=0.0; vBand=0.0; vStrand=0.0;
        #ifdef AURA
        p.z+=(aAura-0.5)*0.28;
        p.x+=sin(uTime*0.5+aAura*2.0)*0.025;
        vBand=aAura;
        #elif defined(ORBIT)
        float t=aT;
        p=orbitPoint(t,aStrand);
        vec3 next=orbitPoint(t+0.002,aStrand);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        vec2 tangent=(modelViewMatrix*vec4(next-p,0.0)).xy;
        vec2 across=vec2(-tangent.y,tangent.x)/max(length(tangent),0.00001);
        float taper=pow(max(0.0,sin(t*3.141593)),0.7);
        view.xy+=across*aSide*(aStrand<0.5?0.075:0.034)*taper;
        vUv=vec2(t,aSide);vT=t;vStrand=aStrand;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;return;
        #elif defined(STREAM) || defined(SOURCE)
        float t=aT, band=aRibbon;
        #ifdef STREAM
        t*=band<0.5?1.0:0.79;
        p=normalPoint(t,band);
        vec3 next=normalPoint(t+0.002,band);
        #else
        // Short light wisps rise from the bowl; there is no ground plane or under-Ball glow.
        float phase=band*1.9;
        float bend=sin(t*4.6-uTime*0.75+phase)-sin(-uTime*0.75+phase);
        p=vec3(bend*t*0.12,-0.065+t*(0.43+0.025*band),0.46+t*0.18+sin(phase)*t*0.085);
        vec3 next=p+vec3(0.003,0.01,0.0);
        #endif
        vec4 view=modelViewMatrix*vec4(p,1.0);
        vec2 tangent=(modelViewMatrix*vec4(next-p,0.0)).xy;
        vec2 across=vec2(-tangent.y,tangent.x)/max(length(tangent),0.00001);
        float taper=pow(max(0.0,sin(aT*3.141593)),0.52);
        #ifdef STREAM
        float width=(aStrand<0.5?(band<0.5?0.135:0.075):0.045)*taper;
        width*=0.87+0.13*sin(t*16.0-uTime*1.2+band);
        float offset=aStrand*0.038*taper*(0.5+0.5*sin(t*12.0-uTime*0.7+band));
        view.xy+=across*(aSide*width+offset);
        #else
        view.xy+=across*aSide*(0.045+band*0.006)*taper;
        #endif
        vUv=vec2(t,aSide); vT=aT; vBand=band; vStrand=aStrand;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view; return;
        #elif defined(STAR) || defined(DUST) || defined(MOTE)
        float age=(uTime-aSeed.x)/aSeed.w;
        float elapsed=max(0.0,uTime-aSeed.x);
        vLife=envelope(age)*(0.86+0.14*sin(elapsed*(8.0+aSeed.z*5.0)+aSeed.y));
        #ifdef STAR
        // These events share the exact position, speed and birth times of packetLight().
        if(aTrail>0.5) {
            float t=packetPosition(aSeed.x);
            p=normalPoint(t,0.0);
            vLife*=1.0-smoothstep(uGrowth-0.035,uGrowth+0.015,t);
            vLife*=1.0-smoothstep(0.93,1.0,t);
        } else {
            float angle=aSeed.y+elapsed*0.23;
            p=vec3(sin(angle)*(0.68+aSeed.z*0.44),0.01+aSeed.z*0.80+elapsed*0.09,
                0.60+cos(angle)*0.12);
        }
        float size=0.28+aSeed.z*0.13;
        #elif defined(MOTE)
        // Short spiraling flights leave the source; no ballistic debris or decorative objects.
        float angle=aSeed.y+elapsed*2.0;
        float radius=0.025+elapsed*(0.16+aSeed.z*0.13);
        p=vec3(sin(angle)*radius,-0.055+elapsed*(0.48+aSeed.z*0.20),
            0.54+elapsed*0.18+cos(angle)*radius*0.25);
        float size=0.070+aSeed.z*0.050;
        #else
        float angle=aSeed.y+elapsed*0.32;
        float radius=0.20+aSeed.z*0.74;
        p=vec3(sin(angle)*radius,-0.02+aSeed.z*0.78+elapsed*0.12,0.46+cos(angle)*radius*0.48);
        float size=0.045+aSeed.z*0.038;
        #endif
        vec4 view=modelViewMatrix*vec4(p,1.0);
        view.xy+=(uv-0.5)*size;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view; return;
        #endif
        vCardPosition=(uEffectToCard*vec4(p,1.0)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }
`;

const fragment = /* glsl */ `
    ${field}
    uniform float uOpacity, uPass;
    uniform vec3 uCameraCard;
    varying vec3 vCardPosition;
    varying vec2 vUv;
    varying float vLife, vT, vBand, vStrand;
    // Fairy/Dragon's disjoint card-space passes preserve front/back depth as the card spins.
    bool behindCard() {
        vec3 ray=vCardPosition-uCameraCard;
        if(abs(ray.z)<0.00001)return false;
        float t=((uCameraCard.z>=0.0?0.01:-0.01)-uCameraCard.z)/ray.z;
        vec2 q=abs(uCameraCard.xy+t*ray.xy)-vec2(0.31,0.46);
        return t>0.0&&t<1.0&&(length(max(q,0.0))+min(max(q.x,q.y),0.0)-0.04)<0.0;
    }
    void main() {
        bool behind=behindCard(); if(uPass<0.5?!behind:behind)discard;
        float alpha=0.0, hot=0.0;
        #ifdef STREAM
        float side=vUv.y;
        float core=exp(-side*side*34.0);
        float shoulder=exp(-side*side*9.0);
        float halo=exp(-side*side*3.4)*0.19;
        float packet=packetLight(vUv.x);
        float fine=0.93+0.07*sin(vUv.x*110.0-uFlowTime*16.0+vBand);
        float head=min(uGrowth-vBand*0.045,1.04-uImage*0.95);
        float grown=1.0-smoothstep(head-0.055,head+0.005,vT);
        alpha=(core*(0.65+packet*0.25)*fine+shoulder*0.17+halo)*grown*0.79;
        alpha*=vBand<0.5?1.0:0.31;
        alpha*=vStrand<0.5?1.0:0.25;
        hot=core;
        #elif defined(ORBIT)
        float core=exp(-vUv.y*vUv.y*44.0),halo=exp(-vUv.y*vUv.y*5.0);
        float wave=0.5+0.5*sin(vT*23.0-uFlowTime*3.5+vStrand*2.0);
        float flowing=0.25+0.75*pow(wave,3.0);
        alpha=(core*0.42+halo*0.12)*flowing*(vStrand<0.5?1.0:0.45);
        alpha*=1.0-smoothstep(uGrowth-0.08,uGrowth+0.01,vT);
        hot=core;
        #elif defined(AURA)
        // Psychic's layered moving folds, translated into sparse pearl radiance.
        vec2 p=(vUv-0.5)*2.0;
        float phase=vBand*2.3;
        float warp=0.25*sin(p.y*5.0-uFlowTime*1.05+phase);
        float fold=0.5+0.5*sin((p.x+warp)*11.0+p.y*3.0+uFlowTime*1.25);
        float detail=0.5+0.5*sin(p.x*18.0-p.y*13.0+uFlowTime*1.8+phase);
        float field=exp(-dot(p*vec2(1.1,0.8),p*vec2(1.1,0.8))*2.0);
        float bounds=(1.0-smoothstep(0.60,0.98,max(abs(p.x),abs(p.y))))
            *smoothstep(0.0,0.16,vUv.y);
        alpha=field*bounds*(0.040+pow(fold,5.0)*(0.24+detail*0.16));
        alpha*=1.0-smoothstep(uGrowth-0.1,uGrowth+0.1,vUv.y);
        hot=fold;
        #elif defined(SOURCE)
        float core=exp(-vUv.y*vUv.y*20.0);
        float soft=exp(-vUv.y*vUv.y*4.0);
        float flow=0.68+0.32*sin(vT*18.0-uFlowTime*4.0+vBand*1.9);
        alpha=(core*0.32+soft*0.20)*pow(1.0-vT,0.75)*flow;
        alpha*=smoothstep(0.0,0.10,vT)*(1.0-smoothstep(uGrowth-0.08,uGrowth+0.06,vT));
        hot=core;
        #elif defined(POOL)
        float r=length((vUv-0.5)*2.0);
        float ring=pow(0.5+0.5*sin(r*35.0-uTime*1.9),20.0);
        alpha=(exp(-r*r*24.0)*0.25+ring*0.17)*(1.0-smoothstep(0.42,0.97,r));
        #else
        vec2 p=(vUv-0.5)*2.0;
        float r2=dot(p,p), core=exp(-r2*85.0);
        #ifdef STAR
        float arms=exp(-abs(p.x)*60.0-abs(p.y)*2.8)+exp(-abs(p.y)*60.0-abs(p.x)*2.8);
        alpha=(core+arms*0.92+exp(-r2*7.0)*0.16)*vLife;
        alpha*=1.0-smoothstep(0.70,1.0,max(abs(p.x),abs(p.y)));
        #else
        alpha=(core*0.78+exp(-r2*10.0)*0.13)*vLife;
        #endif
        hot=core;
        #endif
        vec2 q=abs(vCardPosition.xy);
        float center=(1.0-smoothstep(0.27,0.40,q.x))*(1.0-smoothstep(0.43,0.55,q.y));
        alpha*=1.0-uMorph*center*0.98;
        alpha=clamp(alpha*uOpacity,0.0,0.88);
        if(alpha<0.002)discard;
        vec3 color=mix(vec3(1.0,0.93,0.85),vec3(1.0,0.99,0.97),hot);
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
    }
`;

/** White cores, broad soft shoulders and halos are shaded together without bloom. */
export function normalMaterial(kind: NormalLayer, pass: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        defines: { [kind.toUpperCase()]: 1 },
        uniforms: {
            uTime: { value: 0 }, uFlowTime: { value: 0 }, uGrowth: { value: 0 }, uMorph: { value: 0 }, uImage: { value: 0 },
            uOpacity: { value: 0 }, uPass: { value: pass },
            uEffectToCard: { value: new THREE.Matrix4() }, uViewToCard: { value: new THREE.Matrix4() },
            uCameraCard: { value: new THREE.Vector3() },
        },
        vertexShader: vertex, fragmentShader: fragment,
        transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
        side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    });
}
