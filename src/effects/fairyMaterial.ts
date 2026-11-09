import * as THREE from 'three';
import { dragonMaterial } from './dragonMaterial';

/** Dragon's traveling-event mechanism, with independent, longer Fairy envelopes. */
export const FAIRY_FLARES = [
    { birth: 0.24, duration: 0.90, band: 0, from: 0.04, to: 0.43, strength: 0.65 },
    { birth: 0.58, duration: 1.10, band: 1, from: 0.22, to: 0.85, strength: 0.85 },
    { birth: 0.91, duration: 1.00, band: 0, from: 0.46, to: 0.96, strength: 1.00 },
    { birth: 1.62, duration: 0.95, band: 1, from: 0.15, to: 0.66, strength: 0.62 },
    { birth: 2.05, duration: 0.85, band: 0, from: 0.08, to: 0.49, strength: 0.40 },
] as const;

const events = FAIRY_FLARES.map((f, i) => `if(id==${i})return vec4(${f.birth},${f.duration},${f.band.toFixed(1)},${f.strength});`).join('\n');
const ranges = FAIRY_FLARES.map((f, i) => `if(id==${i})return vec2(${f.from},${f.to});`).join('\n');

// All trajectories and lighting positions use Ball-local coordinates. Card-space
// varyings are only for the disjoint front/back passes, as in Dragon.
const field = /* glsl */ `
    uniform float uTime, uGrowth, uMorph;
    const vec3 source=vec3(0.0,-0.065,0.46);
    vec3 bezier(vec3 a,vec3 b,vec3 c,vec3 d,float t){
        float s=1.0-t;return s*s*s*a+3.0*s*s*t*b+3.0*s*t*t*c+t*t*t*d;
    }
    vec3 fairyPoint(float h,float band,float time){
        float t=h<0.52?h/0.52:(h-0.52)/0.48;
        vec3 p;
        if(band<0.5){
            p=h<0.52
                ?bezier(source,vec3(0.66,0.12,0.70),vec3(0.30,0.35,0.76),vec3(-0.37,0.56,0.60),t)
                :bezier(vec3(-0.37,0.56,0.60),vec3(-0.93,0.76,0.44),vec3(0.78,0.87,0.34),vec3(0.54,1.12,0.43),t);
        }else{
            p=h<0.52
                ?bezier(source,vec3(-0.70,0.07,0.18),vec3(0.83,0.28,0.16),vec3(0.52,0.49,0.23),t)
                :bezier(vec3(0.52,0.49,0.23),vec3(0.88,0.73,0.07),vec3(-0.87,0.88,0.22),vec3(-0.34,1.25,0.42),t);
        }
        float envelope=sin(clamp(h,0.0,1.0)*3.14159);
        p+=envelope*vec3(0.025*sin(h*12.0-time*0.65+band*2.0),
            0.012*sin(h*16.0-time*0.85),0.027*sin(h*9.0-time*0.55+band));
        // Keep Dragon's full lateral span independent of card materialization.
        return p;
    }
    vec4 flareEvent(int id){${events}return vec4(0.0,1.0,0.0,0.0);}
    vec2 flareRange(int id){${ranges}return vec2(0.0);}
    float flareLife(float age){return smoothstep(0.0,0.25,age)*(1.0-smoothstep(0.55,1.0,age));}
`;

const vertex = /* glsl */ `
    ${field}
    uniform mat4 uEffectToCard,uViewToCard;
    varying vec3 vCardPosition,vLocalPosition;
    varying vec2 vUv;
    varying float vBand,vStrand,vLife,vT;
    #ifdef FLARE
    attribute float aFlare;
    #elif defined(SPARK) || defined(STAR)
    attribute vec4 aEvent;
    attribute vec3 aLaunch;
    #elif defined(PETAL)
    attribute vec4 aSeed;
    #endif
    mat3 rotatePetal(vec3 a){
        float cx=cos(a.x),sx=sin(a.x),cy=cos(a.y),sy=sin(a.y),cz=cos(a.z),sz=sin(a.z);
        return mat3(cz,sz,0.0,-sz,cz,0.0,0.0,0.0,1.0)
            *mat3(cy,0.0,-sy,0.0,1.0,0.0,sy,0.0,cy)
            *mat3(1.0,0.0,0.0,0.0,cx,sx,0.0,-sx,cx);
    }
    void main(){
        vec3 p=position;
        vUv=uv;vBand=0.0;vStrand=0.0;vLife=1.0;vT=0.0;vLocalPosition=vec3(0.0);
        #ifdef FLARE
        int id=int(aFlare+0.5);vec4 event=flareEvent(id);vec2 range=flareRange(id);
        float age=(uTime-event.x)/event.y;
        float h=mix(range.x,range.y,clamp(age,0.0,1.0));
        p=fairyPoint(h,event.z,uTime);
        vLife=flareLife(age)*event.w*(1.0-smoothstep(uGrowth*(1.0-uMorph*0.30)-0.06,uGrowth*(1.0-uMorph*0.30)+0.01,h));
        vec4 view=modelViewMatrix*vec4(p,1.0);
        view.xy+=(uv-0.5)*(0.17+event.w*0.09);
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;return;
        #elif defined(SPARK) || defined(STAR)
        float age=max(0.0,uTime-aEvent.x),life=age/aEvent.y;
        vLife=smoothstep(0.0,0.14,life)*(1.0-smoothstep(0.38,1.0,life))*step(aEvent.x,uTime);
        vec3 origin=fairyPoint(aEvent.w,aEvent.z,aEvent.x);
        vec3 tangent=normalize(fairyPoint(aEvent.w+0.003,aEvent.z,aEvent.x)-origin);
        vec3 velocity=tangent*0.13+aLaunch;
        float trailAge=max(0.0,age-(1.0-uv.x)*0.13);
        #ifdef STAR
        trailAge=age;
        #endif
        float drag=(1.0-exp(-trailAge*1.45))/1.45;
        p=origin+velocity*drag+vec3(sin(trailAge*2.0)*trailAge*0.055,-0.07*trailAge*trailAge,0.0);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        #ifdef STAR
        view.xy+=(uv-0.5)*(0.038+0.015*sin(aEvent.x*19.0));
        #else
        vec2 motion=(modelViewMatrix*vec4(velocity,0.0)).xy;
        motion/=max(length(motion),0.001);
        float head=exp(-pow((uv.x-0.94)*22.0,2.0));
        view.xy+=vec2(-motion.y,motion.x)*(uv.y*2.0-1.0)*(0.002+head*0.008)*smoothstep(0.0,0.3,uv.x);
        #endif
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;return;
        #elif defined(PETAL)
        float age=max(0.0,uTime-aSeed.x),phase=aSeed.y;
        vLife=smoothstep(0.0,0.28,age)*(1.0-smoothstep(aSeed.w-0.65,aSeed.w,age))*step(aSeed.x,uTime);
        float radius=0.18+0.54*(1.0-exp(-age*1.5));
        float angle=phase+age*(0.34+aSeed.z*0.15);
        vec3 center=vec3(sin(angle)*radius,-0.035+age*(0.48+aSeed.z*0.07),0.46+cos(angle)*radius*0.55);
        // Each petal keeps its own side as it drifts out of the central spell.
        float outward=sin(phase)>0.0?1.0:-1.0;
        float spread=0.10+0.78*(1.0-exp(-age*1.55))+age*(0.12+aSeed.z*0.04);
        center.x=outward*spread+sin(age*1.7+phase)*0.10;
        center.y-=max(0.0,uTime-2.05)*max(0.0,uTime-2.05)*0.25;
        float side=uv.x*2.0-1.0,t=uv.y;
        float outline=pow(max(0.0001,sin(t*3.14159)),0.73);
        float size=0.84+aSeed.z*0.28;
        vec3 leaf=vec3(side*outline*0.055*(0.86+t*0.25), (t-0.5)*0.18,
            0.036*side*side*outline+0.025*sin(t*3.14159)+side*0.014*sin(t*4.0+phase))*size;
        p=center+rotatePetal(vec3(0.35*sin(age*1.6+phase),0.7*sin(age*1.15+phase),phase*0.35+age*0.42))*leaf;
        #endif
        vLocalPosition=p;
        vCardPosition=(uEffectToCard*vec4(p,1.0)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }
`;

const fragment = /* glsl */ `
    ${field}
    uniform float uOpacity,uImage,uPass,uSourceLight;
    uniform vec3 uCameraCard;
    varying vec3 vCardPosition,vLocalPosition;
    varying vec2 vUv;
    varying float vBand,vStrand,vLife,vT;
    bool behindCard(){
        vec3 ray=vCardPosition-uCameraCard;if(abs(ray.z)<0.00001)return false;
        float t=((uCameraCard.z>=0.0?0.01:-0.01)-uCameraCard.z)/ray.z;
        vec2 q=abs(uCameraCard.xy+t*ray.xy)-vec2(0.31,0.46);
        return t>0.0&&t<1.0&&(length(max(q,0.0))+min(max(q.x,q.y),0.0)-0.04)<0.0;
    }
    void main(){
        bool behind=behindCard();if(uPass<0.5?!behind:behind)discard;
        vec3 pink=vec3(1.00,0.065,0.36),pearl=vec3(1.40,0.91,1.14);
        vec3 color=pink;float alpha=0.0;
        #ifdef PETAL
        // Reconstruct normals after curl/tumble. Normal, light and view vectors
        // share Ball-local space; back faces retain wrapped transmitted light.
        vec3 n=normalize(cross(dFdx(vLocalPosition),dFdy(vLocalPosition)));
        vec3 delta=source-vLocalPosition;
        float distance2=max(dot(delta,delta),0.001);
        vec3 l=delta*inversesqrt(distance2);
        float diffuse=max(0.0,dot(n,l)),transmission=max(0.0,-dot(n,l));
        float attenuation=uSourceLight/(1.0+distance2*5.5);
        float edge=pow(abs(vUv.x*2.0-1.0),5.0);
        float vein=exp(-pow((vUv.x-0.5)*24.0,2.0))*0.12;
        color=mix(vec3(0.42,0.035,0.16),vec3(1.0,0.32,0.58),0.35+vUv.y*0.30);
        color*=0.72+attenuation*(0.75*diffuse+0.30*transmission);
        color+=pearl*(attenuation*(diffuse*0.25+edge*(0.12+transmission*0.30))+vein*0.28);
        alpha=vLife*0.96;
        #elif defined(POOL)
        vec2 p=(vUv-0.5)*2.0;float r=length(p),angle=atan(p.y,p.x);
        float rings=pow(max(0.0,sin(r*36.0-uTime*2.2+sin(angle*3.0+uTime*0.5)*0.3)),22.0);
        alpha=(rings*0.38+exp(-r*r*12.0)*0.25)*(1.0-smoothstep(0.62,0.97,r));
        color=mix(pink,pearl,exp(-r*r*35.0)*0.85);
        #elif defined(FLARE) || defined(STAR)
        vec2 p=(vUv-0.5)*2.0;float r2=dot(p,p);
        float core=exp(-r2*90.0);
        float crossStar=exp(-abs(p.x)*85.0-abs(p.y)*3.5)+exp(-abs(p.y)*85.0-abs(p.x)*3.5);
        alpha=(core+crossStar*1.05+exp(-r2*7.0)*0.18)*vLife;
        color=mix(pink,pearl,clamp(core+crossStar,0.0,1.0));
        #else
        float side=(vUv.y-0.5)*2.0,head=exp(-pow((vUv.x-0.94)*22.0,2.0));
        alpha=exp(-side*side*8.0)*pow(vUv.x,1.4)*(0.65+head*0.75)*vLife;
        color=mix(pink,pearl,head*0.90);
        #endif
        float clearCard=1.0;
        #if defined(STREAM) || defined(DUST) || defined(SPARK) || defined(STAR)
        vec2 q=abs(vCardPosition.xy);
        float center=(1.0-smoothstep(0.27,0.40,q.x))*(1.0-smoothstep(0.43,0.55,q.y));
        clearCard=1.0-uMorph*center*0.96;
        #endif
        alpha=clamp(alpha*uOpacity*clearCard,0.0,0.96);
        if(alpha<0.002)discard;
        color=vec3(1.0)-exp(-color*1.20);
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
    }
`;

export type FairyLayer = 'stream' | 'flare' | 'spark' | 'star' | 'pool' | 'petal' | 'dust' | 'orbit';

/** Sparse light layers add radiance; petals retain shaded surfaces with alpha composition. */
export function fairyMaterial(kind: FairyLayer, pass: number): THREE.ShaderMaterial {
    if (kind === 'stream' || kind === 'orbit' || kind === 'dust') return dragonMaterial(kind, pass, `${field}
        vec3 dragonPoint(float h,float band,float time){return fairyPoint(h,band,time);}
    `);
    return new THREE.ShaderMaterial({
        defines: { [kind.toUpperCase()]: 1 },
        uniforms: {
            uTime: { value: 0 }, uGrowth: { value: 0 }, uMorph: { value: 0 },
            uOpacity: { value: 0 }, uImage: { value: 0 }, uPass: { value: pass }, uSourceLight: { value: 0 },
            uEffectToCard: { value: new THREE.Matrix4() }, uViewToCard: { value: new THREE.Matrix4() },
            uCameraCard: { value: new THREE.Vector3() },
        },
        vertexShader: vertex, fragmentShader: fragment,
        transparent: true, blending: kind === 'petal' ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    });
}
