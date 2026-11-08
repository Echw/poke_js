import { smokeGridGLSL } from './gpuSmokeShaders';

export const gpuVolumeVertex = `out vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
/** Continuous density sampling shared by view and light rays. */
export const smokeDensityGLSL = /* glsl */ `
    vec2 field(vec3 p){
        vec3 q=gridOf(p);
        if(uOptimized==0||uLinear==0||any(lessThan(q.xy,vec2(0)))||any(greaterThan(q.xy,vec2(float(uN-1))))
            ||q.z<0.0||q.z>=float(uN-1))return max(vec2(0),tri(uField,q).rg);
        int z=int(floor(q.z));vec2 size=vec2(textureSize(uField,0));
        vec2 a=(vec2(z%uTiles,z/uTiles)*float(uN)+q.xy+0.5)/size;
        vec2 b=(vec2((z+1)%uTiles,(z+1)/uTiles)*float(uN)+q.xy+0.5)/size;
        return max(vec2(0),mix(textureLod(uField,a,0.0).rg,textureLod(uField,b,0.0).rg,fract(q.z)));
    }
    float density(vec3 p){return field(p).r;}
`;
export const smokeOpticalDepthGLSL = /* glsl */ `
    float opticalDepth(vec3 p,vec3 light){
        vec3 exitDistances=mix((uBoundsMin-p)/light,(uBoundsMax-p)/light,step(vec3(0),light));
        float distance=min(1.3,min(min(exitDistances.x,exitDistances.y),exitDistances.z));
        float extent=max(0.0,distance),depth=0.0;
        for(int j=0;j<8;j++){
            if(j>=uLightSteps)break;
            float a=float(j)/float(uLightSteps),b=float(j+1)/float(uLightSteps);
            float lo=a*a*extent,hi=b*b*extent;
            depth+=density(p+light*(lo+hi)*0.5)*(hi-lo);
        }
        return depth;
    }
`;
export const gpuVolumeFragment = /* glsl */ `
    precision highp float;precision highp int;
    uniform sampler2D uField,uDepth,uVelocity,uOccupancy;
    uniform vec2 uResolution;
    uniform mat4 uInvProjection,uCameraWorld,uWorldToBowl;
    uniform vec3 uBoundsMin,uBoundsMax;
    uniform float uSteps,uDensityScale,uFade;
    uniform float uIceLight;
    #ifdef POISON_SMOKE
    uniform float uPoisonTime;
    float poisonWisps(vec3 p) {
        // Continuous world-space detail advects upwards with the simulated volume.
        p.y-=uPoisonTime*0.25;
        p.x+=sin(p.y*5.0+uPoisonTime*0.55)*0.12;
        float n=sin(p.x*12.0+sin(p.z*9.0))*sin(p.y*11.0-p.z*5.0);
        n+=0.42*sin(p.x*25.0+p.y*19.0)*sin(p.z*22.0-p.y*16.0);
        return 0.32+0.68*smoothstep(-0.65,0.55,n);
    }
    #endif
    uniform int uLightSteps,uDebugView,uVelocityN,uVelocityTiles;
    uniform float uVelocityH;
    uniform int uOptimized,uLinear,uBrickN,uBrickTiles;
    in vec3 vWorld;out vec4 outColor;
    ${smokeGridGLSL}
    ${smokeDensityGLSL}
    ${smokeOpticalDepthGLSL}
    vec3 velocity(vec3 p){
        vec3 q=(p-uDomainMin)/uVelocityH-0.5;
        return vec3(triAt(uVelocity,q-vec3(0.5,0,0),uVelocityN,uVelocityTiles).x,
            triAt(uVelocity,q-vec3(0,0.5,0),uVelocityN,uVelocityTiles).y,
            triAt(uVelocity,q-vec3(0,0,0.5),uVelocityN,uVelocityTiles).z);
    }
    float illumination(vec3 p,vec3 light){
        return exp(-opticalDepth(p,light)*uDensityScale*3.5);
    }
    void main(){
        vec3 ro=cameraPosition,rd=normalize(vWorld-ro);
        vec3 safe=mix(vec3(0.00001),rd,step(vec3(0.00001),abs(rd)));
        vec3 a=(uBoundsMin-ro)/safe,b=(uBoundsMax-ro)/safe,lo=min(a,b),hi=max(a,b);
        float start=max(0.0,max(max(lo.x,lo.y),lo.z)),end=min(min(hi.x,hi.y),hi.z);
        vec2 uv=gl_FragCoord.xy/uResolution;
        vec4 v=uInvProjection*vec4(uv*2.0-1.0,texture(uDepth,uv).r*2.0-1.0,1);
        v/=v.w;end=min(end,dot((uCameraWorld*v).xyz-ro,rd));
        if(end<=start)discard;
        float dt=(end-start)/uSteps;
        float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
        vec3 light=normalize(vec3(-0.70,0.55,0.5));
        vec4 acc=vec4(0);float t=start+dt*jitter;
        int skipUntil=0;
        for(int i=0;i<192;i++){
            if(float(i)>=uSteps||t>end||acc.a>0.985)break;
            // Keep every addition on the original sample lattice, including skipped samples.
            if(i<skipUntil){t+=dt;continue;}
            if(uOptimized==1){
                float brickSize=uH*8.0;ivec3 brick=ivec3(floor((ro+rd*t-uDomainMin)/brickSize));
                float maximum=fetchAt(uOccupancy,brick,uBrickN,uBrickTiles).r;
                if(maximum<=0.004){
                    vec3 cellMin=uDomainMin+vec3(brick)*brickSize;
                    vec3 next=mix(cellMin,cellMin+brickSize,step(vec3(0),rd));
                    vec3 distances=(next-(ro+rd*t))/safe;
                    float exitDistance=max(0.0,min(min(distances.x,distances.y),distances.z));
                    // Leave the last original sample before the boundary to recheck conservatively.
                    int count=max(1,int(floor(exitDistance/dt)));
                    skipUntil=i+count;t+=dt;continue;
                }
            }
            vec3 p=ro+rd*t;vec2 sampleField=field(p);float d=sampleField.r;
            #ifdef POISON_SMOKE
            if(d>0.004)d*=poisonWisps(p);
            #endif
            if(d>0.004){
                vec3 color;
                if(uDebugView==1)color=vec3(0.72);
                else if(uDebugView==2){vec3 v=velocity(p);color=vec3(0.5)+0.5*v/max(length(v),0.02);}
                else{
                    vec3 bowl=(uWorldToBowl*vec4(p,1)).xyz;
                    vec3 source=bowl-vec3(0,0.10,0.25);
                    float bowlGlow=exp(-dot(source,source)*5.0)*uIceLight;
                    float lighting=illumination(p,light);
                    // Pale, milky frost keeps cooler shadows without a saturated blue veil.
                    #ifdef POISON_SMOKE
                    color=vec3(0.018,0.001,0.028)+vec3(0.20,0.005,0.32)*lighting
                        +vec3(0.42,0.015,0.56)*bowlGlow;
                    #elif defined(GROUND_SMOKE)
                    color=vec3(0.055,0.030,0.012)+vec3(0.30,0.19,0.09)*lighting
                        +vec3(0.36,0.17,0.035)*bowlGlow;
                    #elif defined(FIGHTING_SMOKE)
                    float impactGlow=exp(-dot(source,source)*19.0)*uIceLight;
                    color=vec3(0.035,0.001,0.005)+vec3(0.34,0.006,0.012)*lighting
                        +vec3(0.65,0.045,0.003)*impactGlow;
                    #else
                    color=vec3(0.06,0.10,0.16)+vec3(0.20,0.27,0.34)*lighting
                        +vec3(0.08,0.14,0.20)*bowlGlow;
                    #endif
                }
                float alpha=1.0-exp(-d*dt*uDensityScale*3.5);
                acc.rgb+=(1.0-acc.a)*alpha*color;acc.a+=(1.0-acc.a)*alpha;
            }
            t+=dt;
        }
        if(acc.a<0.003)discard;outColor=acc*uFade;
    }
`;
