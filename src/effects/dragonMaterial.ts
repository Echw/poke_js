import * as THREE from 'three';

/** Local accents travel over selected bends; shared by stream shading and star sprites. */
export const DRAGON_FLARES = [
    { birth: 0.25, duration: 0.76, band: 0, from: 0.06, to: 0.38, strength: 0.55 },
    { birth: 0.68, duration: 0.96, band: 0, from: 0.40, to: 0.70, strength: 1.00 },
    { birth: 0.58, duration: 1.08, band: 0, from: 0.70, to: 0.98, strength: 0.92 },
    { birth: 1.22, duration: 1.02, band: 2, from: 0.15, to: 0.68, strength: 0.60 },
    { birth: 1.66, duration: 0.86, band: 1, from: 0.45, to: 0.91, strength: 0.65 },
    { birth: 2.20, duration: 0.78, band: 1, from: 0.12, to: 0.60, strength: 0.40 },
] as const;

const flareFunctions = DRAGON_FLARES.map((f, i) => `
    if (id == ${i}) return vec4(${f.birth.toFixed(3)},${f.duration.toFixed(3)},${f.band.toFixed(1)},${f.strength.toFixed(3)});`).join('');
const flareRanges = DRAGON_FLARES.map((f, i) => `
    if (id == ${i}) return vec2(${f.from.toFixed(3)},${f.to.toFixed(3)});`).join('');

/** Ball-local paths. Each has its own silhouette and depth, rather than a phase-shifted helix. */
const field = /* glsl */ `
    uniform float uTime;
    uniform float uGrowth;
    uniform float uMorph;
    vec3 bezier(vec3 a, vec3 b, vec3 c, vec3 d, float t) {
        float s=1.0-t;
        return s*s*s*a+3.0*s*s*t*b+3.0*s*t*t*c+t*t*t*d;
    }
    vec3 dragonPoint(float h, float band, float time) {
        vec3 source=vec3(0.0,-0.065,0.46);
        vec3 p;
        float t=h<0.52 ? h/0.52 : (h-0.52)/0.48;
        if (band<0.5) {
            p=h<0.52
                ? bezier(source,vec3(0.66,0.12,0.70),vec3(0.30,0.35,0.76),vec3(-0.37,0.56,0.60),t)
                : bezier(vec3(-0.37,0.56,0.60),vec3(-0.93,0.76,0.44),vec3(0.78,0.87,0.34),vec3(0.54,1.12,0.43),t);
        } else if (band<1.5) {
            p=h<0.52
                ? bezier(source,vec3(-0.70,0.07,0.18),vec3(0.83,0.28,0.16),vec3(0.52,0.49,0.23),t)
                : bezier(vec3(0.52,0.49,0.23),vec3(0.88,0.73,0.07),vec3(-0.87,0.88,0.22),vec3(-0.34,1.25,0.42),t);
        } else {
            p=h<0.52
                ? bezier(source,vec3(0.43,0.14,0.14),vec3(-0.69,0.30,0.08),vec3(-0.52,0.61,0.24),t)
                : bezier(vec3(-0.52,0.61,0.24),vec3(-0.30,0.96,0.72),vec3(0.46,1.02,0.70),vec3(0.17,1.28,0.36),t);
        }
        float envelope=sin(clamp(h,0.0,1.0)*3.14159);
        p.x+=envelope*(0.042*sin(h*10.0-time*(1.1+band*0.21)+band*2.0));
        p.y+=envelope*0.021*sin(h*17.0-time*1.7+band);
        p.z+=envelope*0.055*sin(h*9.0-time*0.9+band*2.1);
        return p;
    }
    vec4 flareEvent(int id) { ${flareFunctions} return vec4(0.0,1.0,0.0,0.0); }
    vec2 flareRange(int id) { ${flareRanges} return vec2(0.0); }
    float flareLife(float age) {
        return smoothstep(0.0,0.13,age)*(1.0-smoothstep(0.62,1.0,age));
    }
`;

const vertex = (energyField = field) => /* glsl */ `
    ${energyField}
    uniform mat4 uEffectToCard;
    uniform mat4 uViewToCard;
    varying vec3 vCardPosition;
    varying vec2 vUv;
    varying float vBand;
    varying float vStrand;
    varying float vLife;
    varying float vT;
    varying vec3 vMistSeed;
    #if defined(STREAM) || defined(ORBIT)
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    attribute float aStrand;
    #elif defined(FLARE)
    attribute float aFlare;
    #elif defined(SPARK) || defined(STAR)
    attribute vec4 aEvent;
    attribute vec3 aLaunch;
    #elif defined(WISP)
    attribute vec4 aMist;
    attribute float aMistBand;
    #elif defined(DUST)
    attribute vec4 aSeed;
    #endif
    void main() {
        vec3 p=position;
        vLife=1.0; vStrand=0.0; vBand=0.0; vT=0.0; vMistSeed=vec3(0.0); vUv=uv;
        #ifdef ORBIT
        // Grass-style low sweeps and a higher counter-current. Radius and width
        // are authored at full size; card growth never expands either layer.
        float t=aT,band=aRibbon,strand=aStrand;
        float angle=t*(band<0.5?9.7:10.8)+uTime*(band<0.5?0.48:-0.32)+band*1.8+strand*0.24;
        float radius=band<0.5?mix(0.24,0.96,smoothstep(0.0,0.38,t)):mix(0.24,0.72,smoothstep(0.0,0.25,t));
        radius*=1.0+0.025*sin(t*21.0-uTime*0.7);
        float height=band<0.5?-0.02+t*0.22+0.13*sin(angle+0.3):0.12+t*1.06+0.065*sin(angle);
        p=vec3(cos(angle)*radius,height,0.46+sin(angle)*radius*0.36);
        vec3 across=normalize(vec3(0.22*cos(angle),1.0,0.12*sin(angle)));
        float width=(strand<0.5?0.080:0.012)*pow(max(0.0,sin(t*3.14159)),0.7);
        p+=across*(aSide*width+strand*0.025*sin(t*16.0-uTime));
        vUv=vec2(t,aSide);vT=t;vBand=band;vStrand=strand;
        #elif defined(STREAM)
        float band=aRibbon;
        float strand=aStrand;
        float h=aT;
        if (strand>0.5) {
            float start=strand<1.5 ? 0.12+0.08*sin(uTime*0.7+band) : 0.58+0.06*sin(uTime*0.9+band);
            h=start+aT*(strand<1.5?0.30:0.27);
        }
        p=dragonPoint(h,band,uTime);
        vec3 tangent=dragonPoint(h+0.002,band,uTime)-p;
        vec3 across=normalize(cross(tangent,vec3(0.0,0.0,1.0)));
        float taper=pow(max(0.0,sin(aT*3.14159)),0.6);
        float width=(strand<0.5 ? (band<0.5?0.245:band<1.5?0.24:0.135) : 0.014)*taper;
        width*=0.77+0.18*sin(h*23.0-uTime*(3.2+band))+0.08*sin(h*57.0-uTime*6.0);
        width*=1.0-smoothstep(uGrowth-0.08,uGrowth+0.005,h);
        float offset=strand<0.5?0.0:sin(aT*3.14159)*(0.05+0.035*sin(h*27.0-uTime*2.0+strand+band));
        p+=across*(aSide*width+offset*(strand<1.5?1.0:-1.0));
        vUv=vec2(h,aSide); vBand=band; vStrand=strand; vT=aT;
        #elif defined(FLARE)
        int id=int(aFlare+0.5);
        vec4 event=flareEvent(id); vec2 range=flareRange(id);
        float age=(uTime-event.x)/event.y;
        float h=mix(range.x,range.y,clamp(age,0.0,1.0));
        p=dragonPoint(h,event.z,uTime);
        vBand=event.z; vLife=flareLife(age)*event.w;
        vLife*=1.0-smoothstep(uGrowth-0.06,uGrowth+0.01,h);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        float size=0.31+event.w*0.13;
        view.xy+=(uv-0.5)*size;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;
        return;
        #elif defined(SPARK) || defined(STAR)
        float age=uTime-aEvent.x;
        float life=clamp(age/aEvent.y,0.0,1.0);
        vBand=aEvent.z;
        vLife=smoothstep(0.0,0.06,life)*(1.0-smoothstep(0.45,1.0,life))*step(0.0,age);
        vec3 origin=dragonPoint(aEvent.w,aEvent.z,aEvent.x);
        vec3 tangent=normalize(dragonPoint(aEvent.w+0.003,aEvent.z,aEvent.x)-origin);
        vec3 velocity=tangent*0.20+aLaunch.xyz;
        float trailAge=max(0.0,age-(1.0-uv.x)*0.18);
        #ifdef STAR
        trailAge=max(0.0,age);
        #endif
        float drag=(1.0-exp(-trailAge*2.8))/2.8;
        p=origin+velocity*drag+vec3(0.0,-0.10*trailAge*trailAge,0.0);
        vec3 motion=velocity*exp(-trailAge*2.8)+vec3(0.0,-0.20*trailAge,0.0);
        vec2 direction=(modelViewMatrix*vec4(motion,0.0)).xy;
        direction/=max(length(direction),0.001);
        vec2 across=vec2(-direction.y,direction.x);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        #ifdef STAR
        float size=0.09+0.035*sin(aEvent.x*41.0);
        view.xy+=(uv-0.5)*size;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;
        return;
        #endif
        float head=exp(-pow((uv.x-0.93)*20.0,2.0));
        float width=(0.0045+head*0.024)*smoothstep(0.0,0.25,uv.x);
        view.xy+=across*(uv.y*2.0-1.0)*width;
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;
        return;
        #elif defined(DUST)
        float age=max(0.0,uTime-aSeed.x),life=age/aSeed.w;
        float h=aSeed.z+age*0.12,angle=aSeed.y+age*0.42;
        float radius=0.18+aSeed.z*1.12+0.06*sin(age*1.7+aSeed.y);
        p=vec3(cos(angle)*radius,-0.04+h*1.12,0.46+sin(angle)*radius*0.43);
        vLife=smoothstep(0.0,0.18,life)*(1.0-smoothstep(0.60,1.0,life))*step(aSeed.x,uTime);
        vLife*=1.0-smoothstep(uGrowth-0.08,uGrowth+0.02,aSeed.z);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        view.xy+=(uv-0.5)*(0.024+0.022*fract(aSeed.y*1.7));
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;return;
        #elif defined(WISP)
        float h=fract(aMist.x+uTime*aMist.z);
        float angle=aMist.y+uTime*0.32;
        float band=aMistBand;
        p=dragonPoint(h,band,uTime);
        p+=vec3(cos(angle)*0.15,sin(angle*1.7)*0.07,sin(angle)*0.18)*sin(h*3.14159);
        vLife=smoothstep(0.03,0.18,h)*(1.0-smoothstep(0.82,1.0,h));
        vLife*=1.0-smoothstep(uGrowth-0.10,uGrowth+0.015,h);
        vBand=band; vT=h;
        vMistSeed=vec3(aMist.y*3.1,aMist.x*7.0,uTime*(0.25+aMist.z));
        vec4 view=modelViewMatrix*vec4(p,1.0);
        float size=aMist.w*(0.65+0.35*sin(h*3.14159));
        view.xy+=(uv-0.5)*vec2(size,size*1.35);
        vCardPosition=(uViewToCard*view).xyz;
        gl_Position=projectionMatrix*view;
        return;
        #endif
        vCardPosition=(uEffectToCard*vec4(p,1.0)).xyz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }
`;

const fragment = (energyField = field) => /* glsl */ `
    ${energyField}
    uniform float uOpacity;
    uniform float uImage;
    uniform float uPass;
    uniform vec3 uCameraCard;
    #ifdef FAIRY
    uniform float uSourceLight;
    #endif
    varying vec3 vCardPosition;
    varying vec2 vUv;
    varying float vBand;
    varying float vStrand;
    varying float vLife;
    varying float vT;
    varying vec3 vMistSeed;
    float hash(vec3 p) { p=fract(p*0.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z); }
    float noise3(vec3 p) {
        vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float fbm(vec3 p) { return noise3(p)*0.67+noise3(p*2.07+7.3)*0.33; }
    bool behindCard() {
        vec3 ray=vCardPosition-uCameraCard;
        if(abs(ray.z)<0.00001)return false;
        float face=uCameraCard.z>=0.0?0.01:-0.01;
        float t=(face-uCameraCard.z)/ray.z;
        vec2 q=abs(uCameraCard.xy+t*ray.xy)-vec2(0.31,0.46);
        return t>0.0&&t<1.0&&(length(max(q,0.0))+min(max(q.x,q.y),0.0)-0.04)<0.0;
    }
    void main() {
        bool behind=behindCard();
        if(uPass<0.5?!behind:behind)discard;
        vec3 blue=vec3(0.003,0.24,1.90);
        vec3 violet=vec3(0.36,0.008,1.05);
        vec3 hot=vec3(1.35,1.85,2.2);
        #ifdef FAIRY
        blue=vec3(1.25,0.045,0.36);
        violet=vec3(0.70,0.012,0.28);
        hot=vec3(1.65,1.12,1.40);
        #endif
        vec3 base=vBand<0.5?blue:vBand<1.5?violet:mix(blue,violet,0.35);
        vec3 color=base;
        float alpha=0.0;
        #ifdef ORBIT
        float t=vUv.x,side=vUv.y;
        float flow=0.28+0.72*smoothstep(-0.35,0.85,sin(t*32.0-uTime*2.0+vBand*3.0)+0.35*sin(t*59.0+uTime));
        float warped=side+0.12*sin(t*45.0-uTime*1.6);
        float core=exp(-warped*warped*20.0),halo=exp(-warped*warped*4.0);
        float head=pow(max(0.0,cos(t*12.0-uTime*2.1+vBand*2.3)),22.0);
        float ends=smoothstep(0.0,0.06,t)*(1.0-smoothstep(0.83,1.0,t));
        ends*=1.0-smoothstep(uGrowth-0.08,uGrowth+0.02,t);
        alpha=(core*(0.70+head*0.52)+halo*0.12)*flow*ends*(vStrand<0.5?1.0:0.5);
        color=mix(base,hot,clamp(core*(0.72+head*0.20),0.0,0.92));
        #elif defined(DUST)
        vec2 p=(vUv-0.5)*2.0;float r2=dot(p,p);
        float core=exp(-r2*35.0),halo=exp(-r2*5.0);
        alpha=(core+halo*0.22)*vLife;
        color=mix(base,hot,core*0.88);
        #elif defined(STREAM)
        float h=vUv.x,side=vUv.y;
        vec3 flow=vec3(h*13.0-uTime*(1.7+vBand*0.27),side*3.2,vBand*4.1);
        #ifdef FAIRY
        flow=vec3(h*13.0-uTime*(0.95+vBand*0.14),side*3.2,vBand*4.1);
        #endif
        float broad=fbm(flow);
        float fine=noise3(flow*vec3(4.1,1.9,1.0)+vec3(-uTime*2.0,0.0,5.0));
        float warped=side+(broad-0.5)*0.58+0.06*sin(h*75.0-uTime*7.0);
        float envelope=1.0-smoothstep(0.12,0.94,abs(warped));
        float core=exp(-warped*warped*95.0);
        float curls=pow(max(0.0,1.0-abs(broad-0.50)*4.0),3.0);
        float activity=0.18+0.82*smoothstep(0.25,0.70,fine);
        float flare=0.0,tail=0.0;
        for(int i=0;i<${DRAGON_FLARES.length};i++) {
            vec4 event=flareEvent(i);
            if(abs(event.z-vBand)>0.1)continue;
            float age=(uTime-event.x)/event.y;
            float head=mix(flareRange(i).x,flareRange(i).y,clamp(age,0.0,1.0));
            float d=h-head;
            float life=flareLife(age)*event.w;
            flare+=exp(-pow(d*55.0,2.0))*life;
            tail+=exp(-abs(d)*24.0)*step(d,0.0)*life;
        }
        float end=(1.0-smoothstep(uGrowth-0.07,uGrowth+0.005,h))*smoothstep(0.0,0.025,vT)
            *(1.0-smoothstep(0.86,1.0,vT));
        alpha=(envelope*(0.25+curls*activity*0.70)+core*(0.35+activity*0.40)+tail*core*0.20)*end;
        color=mix(base*0.60,base,smoothstep(0.16,0.7,curls*activity+core*0.55));
        color=mix(color,hot,clamp(core*(0.14+flare*0.75),0.0,0.9));
        #ifdef FAIRY
        float localLight=uSourceLight/(1.0+h*h*32.0);
        color=mix(color,hot,clamp(core*(0.12+localLight*0.18)+flare*core*0.25,0.0,0.75));
        #endif
        if(vStrand>0.5) {
            alpha=exp(-side*side*8.0)*activity*0.55*end;
            color=base*0.8;
        }
        if(vBand>1.5)alpha*=0.62;
        #ifdef FAIRY
        alpha*=1.0-smoothstep(uGrowth*(1.0-uMorph*0.30)-0.07,uGrowth*(1.0-uMorph*0.30)+0.005,h);
        #endif
        #elif defined(WISP)
        // Six samples through a bounded ellipsoid, with independently advected 3D density.
        vec2 xy=(vUv-0.5)*2.0;
        float r2=dot(xy,xy);
        if(r2>=1.0)discard;
        float depth=sqrt(1.0-r2);
        vec4 sum=vec4(0.0);
        for(int i=0;i<6;i++) {
            float z=mix(-depth,depth,(float(i)+0.5)/6.0);
            vec3 q=vec3(xy,z);
            vec3 drift=vMistSeed+vec3(0.0,-uTime*0.48,0.0);
            vec3 warp=vec3(sin(q.y*3.4+drift.x),sin(q.z*3.0+drift.y),cos(q.x*3.1-drift.z))*0.37;
            float f=fbm(q*3.2+warp+drift);
            float shell=max(0.0,1.0-dot(q,q));
            float density=smoothstep(0.36,0.66,f)*shell*0.29;
            float ridge=pow(max(0.0,1.0-abs(f-0.58)*6.0),4.0);
            vec3 lit=mix(vec3(0.013,0.004,0.060),mix(violet,blue,0.14),ridge*0.85);
            sum.rgb+=(1.0-sum.a)*lit*density;
            sum.a+=(1.0-sum.a)*density;
        }
        color=sum.rgb/max(sum.a,0.001);
        alpha=sum.a*vLife*0.72;
        #elif defined(POOL)
        vec2 p=(vUv-0.5)*2.0;
        float radius=length(p),angle=atan(p.y,p.x);
        float n=fbm(vec3(p*5.0,uTime*0.6));
        float wave=pow(max(0.0,sin(radius*30.0-angle*2.0-uTime*3.0+n*3.0)),14.0);
        float broken=0.22+0.78*smoothstep(0.25,0.75,noise3(vec3(p*7.0,uTime*0.4)));
        float halo=exp(-radius*radius*4.5);
        alpha=(wave*broken*0.50+halo*0.16)*(1.0-smoothstep(0.70,0.98,radius));
        color=mix(blue,violet,0.5+0.5*sin(angle+radius*8.0-uTime));
        #elif defined(FLARE) || defined(STAR)
        vec2 p=(vUv-0.5)*2.0;
        float r=length(p);
        float center=exp(-r*r*72.0);
        float crossStar=exp(-abs(p.x)*100.0-abs(p.y)*2.4)+exp(-abs(p.y)*100.0-abs(p.x)*2.4);
        float diagonal=exp(-abs(p.x-p.y)*100.0-abs(p.x+p.y)*3.8)+exp(-abs(p.x+p.y)*100.0-abs(p.x-p.y)*3.8);
        alpha=(center+crossStar*1.30+diagonal*0.55+exp(-r*r*5.0)*0.22)*vLife;
        color=mix(blue,hot,clamp(center*1.8+crossStar+diagonal,0.0,1.0));
        #ifdef STAR
        alpha=(center*1.2+crossStar*1.8+diagonal*0.9+exp(-r*r*5.0)*0.25)*vLife;
        color=mix(base,hot,clamp(center*0.65+crossStar*0.45,0.0,0.85));
        #endif
        #else
        float side=(vUv.y-0.5)*2.0;
        float head=exp(-pow((vUv.x-0.93)*20.0,2.0));
        alpha=exp(-side*side*9.0)*pow(vUv.x,0.7)*(1.05+head*0.95)*vLife;
        color=mix(base,hot,head);
        #endif
        float clearCard=1.0;
        #if defined(STREAM) || defined(WISP) || defined(ORBIT) || defined(DUST)
        clearCard=mix(1.0,0.08,uMorph*smoothstep(0.04,0.30,vCardPosition.z));
        #ifdef FAIRY
        vec2 q=abs(vCardPosition.xy);
        float center=(1.0-smoothstep(0.27,0.40,q.x))*(1.0-smoothstep(0.43,0.55,q.y));
        clearCard=1.0-uMorph*center*0.96;
        #endif
        #endif
        alpha=clamp(alpha*uOpacity*clearCard*(1.0-uImage*0.2),0.0,0.96);
        if(alpha<0.002)discard;
        color=vec3(1.0)-exp(-color*1.30);
        gl_FragColor=vec4(color,alpha);
        #include <colorspace_fragment>
    }
`;

export type DragonLayer = 'stream' | 'wisp' | 'flare' | 'spark' | 'pool' | 'star' | 'orbit' | 'dust';

/**
 * Dragon's original material; Fairy supplies its independent field only for streams.
 * Both variants share the actual serpentine width, noise, core and flare shading.
 */
export function dragonMaterial(kind: DragonLayer, pass: number, fairyField?: string): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        defines: { [kind.toUpperCase()]: 1, ...(fairyField ? { FAIRY: 1 } : {}) },
        uniforms: {
            uTime: { value: 0 }, uGrowth: { value: 0 }, uMorph: { value: 0 },
            uOpacity: { value: 0 }, uImage: { value: 0 }, uPass: { value: pass },
            uEffectToCard: { value: new THREE.Matrix4() }, uViewToCard: { value: new THREE.Matrix4() },
            uCameraCard: { value: new THREE.Vector3() },
            ...(fairyField ? { uSourceLight: { value: 0 } } : {}),
        },
        vertexShader: vertex(fairyField), fragmentShader: fragment(fairyField),
        transparent: true,
        blending: kind === 'wisp' ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        forceSinglePass: true, toneMapped: false,
    });
}
