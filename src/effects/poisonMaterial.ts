import { liquidCardMaskGLSL, liquidReflectionGLSL } from './liquidSurface';
import { POISON_EVENT_CAPACITY } from './poisonEvents';

/** All field coordinates are Ball-local; event arrays are filled once by PoisonEffect. */
export const poisonSurfaceGLSL = /* glsl */ `
    uniform float uTime;
    uniform vec4 uEvents[${POISON_EVENT_CAPACITY}];
    uniform vec4 uTiming[${POISON_EVENT_CAPACITY}];
    uniform int uEventCount;
    float surfaceHeight(vec2 p) {
        float strength=smoothstep(0.0,0.30,uTime)*(1.0-smoothstep(2.65,3.5,uTime));
        float h=0.005*sin(p.x*17.0+uTime*2.3)*sin(p.y*13.0-uTime*1.7);
        for(int i=0;i<${POISON_EVENT_CAPACITY};i++) {
            if(i>=uEventCount)break;
            vec4 e=uEvents[i],t=uTiming[i];
            float release=e.w>0.5 ? t.x+t.y+0.06 : t.z;
            float r=length(p-e.xy),age=uTime-release;
            float rise=smoothstep(t.x,t.x+t.y,uTime)*(1.0-smoothstep(release,release+0.12,uTime));
            h+=e.z*0.16*rise*exp(-pow(r/(e.z*0.85),2.0));
            if(age>=0.0&&age<0.5) {
                h-=0.035*exp(-pow(r/(e.z*0.8),2.0))*sin(min(age/0.22,1.0)*3.14159265)*(1.0-smoothstep(0.18,0.4,age));
                h+=0.014*sin(r*32.0-age*24.0)*exp(-age*9.0-r*r*18.0)*smoothstep(0.0,0.05,age);
            }
        }
        return -0.14+h*strength*(1.0-smoothstep(0.72,0.88,length(p-vec2(0.0,0.05))));
    }
`;

const varyings = /* glsl */ `
    varying vec3 vWorldPosition;
    varying vec3 vCardPosition;
    varying vec3 vViewNormal;
    varying vec3 vLocal;
    varying vec3 vUnit;
    varying vec4 vEvent;
`;

export const poisonVertex = /* glsl */ `
    uniform mat4 uWorldToCard;
    ${poisonSurfaceGLSL}
    ${varyings}
    #ifdef BUBBLE
    attribute vec4 aEvent;
    #endif
    #ifdef SPLASH
    attribute float aIndex;
    #endif
    void main() {
        vec3 pos=position,n=normal;
        vUnit=normalize(position+vec3(0.000001));
        vEvent=vec4(0.0);
        #ifdef POOL
        pos.z+=0.05;
        pos.y=surfaceHeight(pos.xz);
        float dx=(surfaceHeight(pos.xz+vec2(0.002,0.0))-surfaceHeight(pos.xz-vec2(0.002,0.0)))/0.004;
        float dz=(surfaceHeight(pos.xz+vec2(0.0,0.002))-surfaceHeight(pos.xz-vec2(0.0,0.002)))/0.004;
        n=normalize(vec3(-dx,1.0,-dz));
        #elif defined(SPLASH)
        int index=int(aIndex+0.5);
        vec4 e=uEvents[index],t=uTiming[index];
        float age=uTime-t.z;
        float phase=clamp(age/0.26,0.0,1.0);
        float theta=uv.x*6.2831853,across=uv.y;
        vUnit=vec3(uv,0.0);
        float lobes=pow(0.5+0.5*sin(theta*4.0+t.w),2.0);
        float lift=sin(phase*3.14159265)*(0.04+0.18*lobes);
        float radius=e.z*(0.68+phase*0.8)+across*(0.025+0.025*phase);
        pos=vec3(e.x+cos(theta)*radius,surfaceHeight(e.xy)+lift*across,e.y+sin(theta)*radius);
        n=normalize(vec3(cos(theta)*0.5,0.7,sin(theta)*0.5));
        vEvent.x=step(0.0,age)*(1.0-smoothstep(0.14,0.26,age))*(1.0-e.w);
        #else
        #ifdef BUBBLE
        float wobble=1.0+0.025*sin(position.y*7.0+uTime*19.0+aEvent.y)*sin(position.x*6.0+position.z*5.0+aEvent.y);
        pos*=wobble;
        vEvent=aEvent;
        #endif
        pos=(instanceMatrix*vec4(pos,1.0)).xyz;
        // Inverse transpose for nonuniform instance scale, followed by the host normalMatrix.
        mat3 im=mat3(instanceMatrix);
        n=im*(n/vec3(dot(im[0],im[0]),dot(im[1],im[1]),dot(im[2],im[2])));
        #endif
        vLocal=pos;
        vec4 world=modelMatrix*vec4(pos,1.0);
        vWorldPosition=world.xyz;
        vCardPosition=(uWorldToCard*world).xyz;
        vViewNormal=normalize(normalMatrix*n);
        gl_Position=projectionMatrix*viewMatrix*world;
    }
`;

export const poisonFragment = /* glsl */ `
    uniform sampler2D uEnvironment;
    uniform float uCardImage;
    ${poisonSurfaceGLSL}
    ${varyings}
    void main() {
        float visibility=smoothstep(0.0,0.20,uTime)*(1.0-smoothstep(3.12,3.5,uTime));
        float wetEdge=0.0;
        #ifdef BUBBLE
        if(vLocal.y<surfaceHeight(vLocal.xz)-0.002)discard;
        vec3 direction=normalize(vec3(0.38*sin(vEvent.y),0.65,0.85));
        vec3 unit=normalize(vUnit);
        float angular=acos(clamp(dot(unit,direction),-1.0,1.0));
        float uneven=0.10*sin(unit.x*12.0+vEvent.y)*sin(unit.z*9.0+unit.y*6.0);
        float hole=angular+uneven-vEvent.x*3.5;
        if(vEvent.x>0.001&&hole<0.0)discard;
        wetEdge=vEvent.x>0.001 ? exp(-max(hole,0.0)*60.0) : 0.0;
        #endif
        #ifdef POOL
        visibility*=1.0-smoothstep(0.77,0.88,length(vLocal.xz-vec2(0.0,0.05)));
        #endif
        #ifdef SPLASH
        visibility*=vEvent.x;
        #endif
        #ifdef DROP
        visibility*=1.0-smoothstep(1.45,1.80,abs(vLocal.x));
        #endif
        if(visibility<0.003)discard;
        vec3 n=normalize(vViewNormal);
        if(!gl_FrontFacing)n=-n;
        vec3 normalWorld=normalize(vec3(dot(viewMatrix[0].xyz,n),dot(viewMatrix[1].xyz,n),dot(viewMatrix[2].xyz,n)));
        vec3 view=normalize(cameraPosition-vWorldPosition);
        float facing=clamp(dot(normalWorld,view),0.0,1.0);
        float rim=pow(1.0-facing,3.2);
        ${liquidReflectionGLSL}
        vec3 key=normalize(vec3(-0.65,0.95,1.25)),side=normalize(vec3(0.85,0.35,1.0));
        float glint=pow(max(dot(normalWorld,normalize(view+key)),0.0),130.0)
            +0.65*pow(max(dot(normalWorld,normalize(view+side)),0.0),190.0);
        float broad=pow(max(dot(reflected,key),0.0),28.0);
        vec3 color=vec3(0.055,0.002,0.09)+environment*vec3(0.25,0.10,0.35)*(0.1+rim*0.4);
        float alpha=0.94*visibility;
        #ifdef BUBBLE
        float edgeLight=0.48+0.72*pow(max(dot(normalWorld,key),0.0),2.0);
        color+=vec3(1.8,0.25,2.8)*rim*edgeLight+vec3(0.36,0.018,0.60)*broad;
        color+=vec3(1.3,0.65,1.4)*glint*3.5+vec3(1.5,0.35,1.8)*wetEdge*(0.5+edgeLight);
        alpha=(0.08+rim*0.88+glint*0.55+wetEdge*0.8)*visibility;
        #elif defined(POOL)
        float nearSource=exp(-dot(vLocal.xz-vec2(0.0,0.30),vLocal.xz-vec2(0.0,0.30))*24.0);
        color=vec3(0.012,0.0006,0.025)+environment*vec3(0.035,0.008,0.055);
        color+=vec3(0.11,0.002,0.20)*(broad*0.5+rim*0.32)+vec3(0.12,0.003,0.21)*nearSource;
        color+=vec3(1.1,0.45,1.3)*glint*2.0;
        #else
        color+=vec3(0.40,0.016,0.65)*(0.25+broad+rim*0.8)+vec3(1.3,0.75,1.4)*glint*3.0;
        #ifdef SPLASH
        float lip=pow(vUnit.y,9.0);
        color+=vec3(1.3,0.28,1.6)*lip;
        alpha=(0.26+lip*0.65+glint*0.45)*visibility;
        #endif
        #endif
        ${liquidCardMaskGLSL}
        gl_FragColor=vec4(color,clamp(alpha,0.0,1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;
