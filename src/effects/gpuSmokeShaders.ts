export const fullscreenVertex = `void main(){gl_Position=vec4(position.xy,0.0,1.0);}`;

/** Cell centers use integer indices; RGB velocities live on the cell's +X/+Y/+Z faces. */
export const smokeGridGLSL = /* glsl */ `
    uniform int uN, uTiles;
    uniform float uH;
    uniform vec3 uDomainMin;
    bool inside(ivec3 c){return all(greaterThanEqual(c,ivec3(0)))&&all(lessThan(c,ivec3(uN)));}
    ivec2 pixelOf(ivec3 c){return c.xy+ivec2(c.z%uTiles,c.z/uTiles)*uN;}
    ivec3 cellOf(){ivec2 p=ivec2(gl_FragCoord.xy);ivec2 tile=p/uN;return ivec3(p%uN,tile.x+tile.y*uTiles);}
    vec3 worldOf(ivec3 c){return uDomainMin+(vec3(c)+0.5)*uH;}
    vec4 fetchAt(sampler2D field,ivec3 c,int n,int tiles){
        if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,ivec3(n))))return vec4(0);
        return texelFetch(field,c.xy+ivec2(c.z%tiles,c.z/tiles)*n,0);
    }
    vec4 fetchField(sampler2D field,ivec3 c){return fetchAt(field,c,uN,uTiles);}
    vec4 triAt(sampler2D field,vec3 q,int n,int tiles){
        ivec3 c=ivec3(floor(q));vec3 f=fract(q);
        return mix(mix(mix(fetchAt(field,c,n,tiles),fetchAt(field,c+ivec3(1,0,0),n,tiles),f.x),
            mix(fetchAt(field,c+ivec3(0,1,0),n,tiles),fetchAt(field,c+ivec3(1,1,0),n,tiles),f.x),f.y),
            mix(mix(fetchAt(field,c+ivec3(0,0,1),n,tiles),fetchAt(field,c+ivec3(1,0,1),n,tiles),f.x),
            mix(fetchAt(field,c+ivec3(0,1,1),n,tiles),fetchAt(field,c+ivec3(1,1,1),n,tiles),f.x),f.y),f.z);
    }
    vec4 tri(sampler2D field,vec3 q){return triAt(field,q,uN,uTiles);}
    vec3 gridOf(vec3 p){return (p-uDomainMin)/uH-0.5;}
`;

export const simulationFragment = /* glsl */ `
    precision highp float;
    precision highp int;
    uniform sampler2D uInput,uVelocity,uDensity,uMask,uCurl,uPressure,uDivergence,uOriginal,uStencil;
    uniform mat4 uWorldToBowl,uBowlToWorld,uWorldToLid,uBowlToPrevious,uLidToPrevious;
    uniform float uDt,uTime,uOpening,uEmission,uFallSpeed,uSpread,uTurbulence,uFadeTime,uAdhesion,uCurlStrength;
    uniform int uVelocityN,uVelocityTiles,uDensityN,uDensityTiles;
    uniform float uVelocityH,uDensityH;
    out vec4 outColor;
    ${smokeGridGLSL}
    const ivec3 X=ivec3(1,0,0),Y=ivec3(0,1,0),Z=ivec3(0,0,1);
    vec4 maskAt(ivec3 c){
        if(any(lessThan(c,ivec3(0)))||any(greaterThanEqual(c,ivec3(uVelocityN))))return vec4(0,0,0,1);
        return fetchAt(uMask,c,uVelocityN,uVelocityTiles);
    }
    bool solid(ivec3 c){return maskAt(c).a>0.5;}
    bool blocked(ivec3 c,ivec3 axis){return solid(c)||solid(c+axis);}
    float wallVelocity(ivec3 c,ivec3 axis,int component){
        vec4 a=maskAt(c),b=maskAt(c+axis);return (a[component]*a.a+b[component]*b.a)/max(a.a+b.a,1.0);
    }
    vec3 velocityAt(vec3 p){
        vec3 q=(p-uDomainMin)/uVelocityH-0.5;
        return vec3(triAt(uVelocity,q-vec3(0.5,0,0),uVelocityN,uVelocityTiles).x,
            triAt(uVelocity,q-vec3(0,0.5,0),uVelocityN,uVelocityTiles).y,
            triAt(uVelocity,q-vec3(0,0,0.5),uVelocityN,uVelocityTiles).z);
    }
    vec3 centerVelocity(ivec3 c){
        if(solid(c))return maskAt(c).rgb;
        vec3 v=fetchField(uVelocity,c).rgb;
        return 0.5*(v+vec3(fetchField(uVelocity,c-X).x,fetchField(uVelocity,c-Y).y,fetchField(uVelocity,c-Z).z));
    }
    bool pointSolid(vec3 p){
        if(any(lessThan(p,uDomainMin))||any(greaterThanEqual(p,uDomainMin+vec3(float(uVelocityN)*uVelocityH))))return true;
        vec3 b=(uWorldToBowl*vec4(p,1)).xyz,l=(uWorldToLid*vec4(p,1)).xyz;
        return (length(b)>0.925&&length(b)<1.075&&b.y< -0.025)
            ||(length(l)>0.925&&length(l)<1.075&&l.y>=-0.025);
    }
    float densityAt(vec3 p){return triAt(uDensity,(p-uDomainMin)/uDensityH-0.5,uDensityN,uDensityTiles).r;}
    // Original seeded gradient noise; derivatives yield a continuous curl force.
    vec3 gradient(ivec3 cell){
        uvec3 h=uvec3(cell)*uvec3(1597334677u,3812015801u,2798796415u)+uvec3(173u,719u,239u);
        h^=h.yzx>>13u;h*=2246822519u;h^=h.zxy>>16u;
        vec3 g=vec3(h&uvec3(65535u))/32767.5-1.0;
        return g/max(length(g),0.001);
    }
    vec4 noiseDerivative(vec3 p){
        ivec3 c=ivec3(floor(p));vec3 f=fract(p);
        vec3 w=f*f*f*(f*(f*6.0-15.0)+10.0),dw=30.0*f*f*(f*(f-2.0)+1.0);
        vec4 result=vec4(0);
        for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++){
            vec3 o=vec3(x,y,z),g=gradient(c+ivec3(x,y,z));float value=dot(g,f-o);
            vec3 weight=mix(1.0-w,w,o),derivative=mix(-dw,dw,o);
            float product=weight.x*weight.y*weight.z;
            result.x+=product*value;
            result.yzw+=product*g+value*derivative*weight.yzx*weight.zxy;
        }return result;
    }
    vec3 curlNoise(vec3 p){
        vec3 a=noiseDerivative(p+vec3(13.1,7.2,3.4)).yzw;
        vec3 b=noiseDerivative(p+vec3(2.7,19.8,11.2)).yzw;
        vec3 c=noiseDerivative(p+vec3(17.4,1.9,23.6)).yzw;
        return vec3(c.y-b.z,a.z-c.x,b.x-a.y);
    }
    float sourceDetail(vec3 p){
        float value=0.0,weight=0.57,scale=4.0;
        for(int i=0;i<3;i++){value+=weight*noiseDerivative(p*scale+vec3(8.3,17.1,4.7)).x;scale*=2.0;weight*=0.5;}
        return pow(clamp(0.50+value*2.8,0.0,1.0),1.4);
    }
    vec3 traceWithVelocity(vec3 p,float dt,vec3 v){
        vec3 mid=p-v*dt*0.5;
        vec3 back=p-velocityAt(mid)*dt;
        return pointSolid(mid)||pointSolid(back)?p:back;
    }
    vec3 trace(vec3 p,float dt){return traceWithVelocity(p,dt,velocityAt(p));}
    float source(vec3 p){
        vec3 q=(uWorldToBowl*vec4(p,1)).xyz;
        #ifdef FIGHTING_SMOKE
        // Bowl-local lobes leave an irregular clear corridor in front of the card.
        float band=smoothstep(-0.32,-0.20,q.y)*(1.0-smoothstep(-0.06,0.08,q.y));
        float lobes=exp(-dot(q.xz-vec2(-0.28,-0.06),q.xz-vec2(-0.28,-0.06))*20.0)
            +0.78*exp(-dot(q.xz-vec2(0.31,-0.13),q.xz-vec2(0.31,-0.13))*24.0)
            +0.40*exp(-dot(q.xz-vec2(0.03,-0.32),q.xz-vec2(0.03,-0.32))*26.0);
        float pulse=exp(-pow((uTime-0.64)/0.095,2.0))*0.7+exp(-pow((uTime-1.02)/0.13,2.0));
        return lobes*band*smoothstep(0.01,0.23,uOpening)*(0.42+2.8*pulse)
            *(1.0-smoothstep(1.15,1.45,uTime))*uEmission;
        #else
        float disk=1.0-smoothstep(0.72,0.90,length(q.xz));
        float band=smoothstep(-0.32,-0.19,q.y)*(1.0-smoothstep(-0.04,0.055,q.y));
        return disk*band*smoothstep(0.01,0.23,uOpening)*(1.0-smoothstep(3.2,3.5,uTime))*uEmission;
        #endif
    }
    float sponge(vec3 p){
        vec3 edge=min(p-uDomainMin,uDomainMin+vec3(float(uN)*uH)-p);
        return 1.0-smoothstep(0.04,0.30,min(min(edge.x,edge.y),edge.z));
    }
    float divergenceAt(ivec3 c){
        if(solid(c))return 0.0;
        vec3 v=fetchField(uVelocity,c).xyz;
        return (v.x-fetchField(uVelocity,c-X).x+v.y-fetchField(uVelocity,c-Y).y+v.z-fetchField(uVelocity,c-Z).z)/uH;
    }
    void main(){
        ivec3 c=cellOf();if(!inside(c)){outColor=vec4(0);return;}
        vec3 p=worldOf(c);
        #if defined(PASS_DENSITY_MASK)
            outColor=vec4(pointSolid(p)?1.0:0.0,0,0,1);
        #elif defined(PASS_MASK)
            vec3 b=(uWorldToBowl*vec4(p,1)).xyz,l=(uWorldToLid*vec4(p,1)).xyz;
            bool bowl=length(b)>0.925&&length(b)<1.075&&b.y< -0.025;
            bool lid=length(l)>0.925&&length(l)<1.075&&l.y>=-0.025;
            vec3 prev=((lid?uLidToPrevious:uBowlToPrevious)*vec4(p,1)).xyz;
            outColor=vec4((p-prev)/uDt,(bowl||lid)?1.0:0.0);
        #elif defined(PASS_COPY)
            outColor=fetchField(uInput,c);
        #elif defined(PASS_ADVECT_VELOCITY)
            vec3 v=vec3(0);
            for(int a=0;a<3;a++){
                ivec3 axis=ivec3(0);axis[a]=1;
                if(blocked(c,axis)){v[a]=wallVelocity(c,axis,a);continue;}
                vec3 face=p+vec3(axis)*uH*0.5;
                vec3 back=trace(face,uDt);
                v[a]=tri(uVelocity,gridOf(back)-vec3(axis)*0.5)[a]*exp(-uDt*0.08);
            }
            outColor=vec4(v,0);
        #elif defined(PASS_CURL)
            vec3 xp=centerVelocity(c+X),xm=centerVelocity(c-X),yp=centerVelocity(c+Y),ym=centerVelocity(c-Y),zp=centerVelocity(c+Z),zm=centerVelocity(c-Z);
            vec3 w=vec3(yp.z-ym.z-zp.y+zm.y,zp.x-zm.x-xp.z+xm.z,xp.y-xm.y-yp.x+ym.x)/(2.0*uH);
            outColor=solid(c)?vec4(0):vec4(w,length(w));
        #elif defined(PASS_FORCES)
            vec3 v=fetchField(uVelocity,c).xyz;
            vec3 eddy=vec3(0);float centerDensity=densityAt(p);
            if(centerDensity>0.003){
                float wavelength=0.6,amplitude=0.45;
                for(int octave=0;octave<3;octave++){
                    float size=max(wavelength,4.0*uVelocityH);
                    eddy+=amplitude*curlNoise(p/size+vec3(0.11,-0.07,0.09)*uTime+float(octave)*vec3(7.1,13.2,5.7));
                    wavelength*=0.5;amplitude*=1.4;
                }
            }
            for(int a=0;a<3;a++){
                ivec3 axis=ivec3(0);axis[a]=1;
                if(blocked(c,axis)){v[a]=wallVelocity(c,axis,a);continue;}
                vec3 face=p+vec3(axis)*uH*0.5;
                vec3 g=vec3(fetchField(uCurl,c+X).w-fetchField(uCurl,c-X).w,
                    fetchField(uCurl,c+Y).w-fetchField(uCurl,c-Y).w,
                    fetchField(uCurl,c+Z).w-fetchField(uCurl,c-Z).w)/(2.0*uH);
                vec3 normal=g/max(length(g),0.0001);
                vec3 w=0.5*(fetchField(uCurl,c).xyz+fetchField(uCurl,c+axis).xyz);
                vec3 force=cross(normal,w)*uH*uCurlStrength*1.5;
                float rho=densityAt(face);
                vec3 q=(uWorldToBowl*vec4(face,1)).xyz;
                float exposed=max(smoothstep(0.86,1.08,length(q.xz)),smoothstep(0.015,0.16,q.y));
                #ifdef FIGHTING_SMOKE
                force.y+=rho*uFallSpeed*(0.35+exposed*1.1);
                #else
                force.y-=rho*uFallSpeed*(0.15+exposed*2.2);
                #endif
                float feed=source(face);
                force+=eddy*uTurbulence*min(rho,1.0)*0.85;
                vec3 radial=vec3(q.x,0,q.z)/max(length(q.xz),0.2);
                vec3 target=mat3(uBowlToWorld)*(radial*(0.14+uSpread*0.3)+vec3(0,0.28,0));
                #ifdef FIGHTING_SMOKE
                float pulse=exp(-pow((uTime-0.64)/0.095,2.0))*0.7+exp(-pow((uTime-1.02)/0.13,2.0));
                target=mat3(uBowlToWorld)*(radial*(0.25+uSpread*pulse)+vec3(0,0.65+1.35*pulse,0));
                #endif
                v[a]+=uDt*force[a];
                v[a]=mix(v[a],target[a],1.0-exp(-feed*uDt*5.0));
                float nearWall=(1.0-smoothstep(0.04,0.16,abs(length(q)-1.025)))*(1.0-smoothstep(-0.03,0.10,q.y));
                vec3 worldNormal=mat3(uBowlToWorld)*q;
                vec3 wallNormal=worldNormal/max(length(worldNormal),0.0001);
                vec3 wall=(face-(uBowlToPrevious*vec4(face,1)).xyz)/uDt;
                vec3 relative=velocityAt(face)-wall;
                vec3 tangent=relative-wallNormal*dot(wallNormal,relative);
                v[a]-=(1.0-exp(-uDt*nearWall*uAdhesion*1.5))*tangent[a];
                v[a]*=exp(-uDt*sponge(face)*5.0);
                v[a]=clamp(v[a],-3.0,3.0);
            }
            outColor=vec4(v,0);
        #elif defined(PASS_DIVERGENCE)
            outColor=vec4(divergenceAt(c),0,0,1);
        #elif defined(PASS_STENCIL)
            if(solid(c)){outColor=vec4(64,0,0,1);return;}
            int code=0,bit=0;
            for(int a=0;a<3;a++)for(int s=-1;s<=1;s+=2){
                ivec3 axis=ivec3(0);axis[a]=s;ivec3 neighbor=c+axis;
                if(solid(neighbor))code|=1<<bit;
                bit++;
            }
            outColor=vec4(float(code),0,0,1);
        #elif defined(PASS_PRESSURE)
            int code=int(fetchField(uStencil,c).r);
            if((code&64)!=0){outColor=vec4(0);return;}
            float sum=0.0,count=0.0;int bit=0;
            for(int a=0;a<3;a++)for(int s=-1;s<=1;s+=2){
                ivec3 axis=ivec3(0);axis[a]=s;ivec3 neighbor=c+axis;
                if((code&(1<<bit))==0){sum+=fetchField(uPressure,neighbor).r;count+=1.0;}
                bit++;
            }
            float q=(sum-fetchField(uDivergence,c).r*uH*uH)/max(count,1.0);
            outColor=vec4(q,0,0,1);
        #elif defined(PASS_PROJECT)
            vec3 v=fetchField(uVelocity,c).xyz;float q=fetchField(uPressure,c).r;
            for(int a=0;a<3;a++){
                ivec3 axis=ivec3(0);axis[a]=1;
                v[a]=blocked(c,axis)?wallVelocity(c,axis,a):v[a]-(fetchField(uPressure,c+axis).r-q)/uH;
            }
            outColor=vec4(v,0);
        #elif defined(PASS_DENSITY_FORWARD)
            if(pointSolid(p)){outColor=vec4(0);return;}
            vec3 back=trace(p,uDt);
            outColor=vec4(max(0.0,tri(uInput,gridOf(back)).r),0,0,1);
        #elif defined(PASS_DENSITY_CORRECT)
            if(pointSolid(p)){outColor=vec4(0);return;}
            vec3 v=velocityAt(p);
            vec3 back=traceWithVelocity(p,uDt,v),forward=traceWithVelocity(p,-uDt,v);
            // Match the former R16F/RGBA16F reverse target exactly before correction.
            float reverse=max(0.0,tri(uInput,gridOf(forward)).r);
            reverse=unpackHalf2x16(packHalf2x16(vec2(reverse,0))).x;
            ivec3 lo=ivec3(floor(gridOf(back)));
            float minimum=1e10,maximum=0.0;
            for(int z=0;z<2;z++)for(int y=0;y<2;y++)for(int x=0;x<2;x++){
                float value=fetchField(uOriginal,lo+ivec3(x,y,z)).r;minimum=min(minimum,value);maximum=max(maximum,value);
            }
            float value=fetchField(uInput,c).r+0.5*(fetchField(uOriginal,c).r-reverse);
            value=clamp(value,minimum,maximum);
            value*=exp(-uDt*(0.16/max(uFadeTime,0.1)+sponge(p)*12.0));
            vec3 local=(uWorldToBowl*vec4(p,1)).xyz;
            float feed=source(p);
            if(feed>0.0001)value+=feed*uDt*1.4*sourceDetail(local+vec3(0.08,-0.10,0.06)*uTime);
            outColor=vec4(clamp(value,0.0,3.0),0,0,1);
        #endif
    }
`;
