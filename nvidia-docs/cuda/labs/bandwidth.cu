// Teaching experiment: logical traffic is NOT a direct HBM traffic measurement.
#include <cuda_runtime.h>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#define CUDA(call) do { cudaError_t err = (call); if (err != cudaSuccess) { \
  std::fprintf(stderr,"%s:%d: %s\n",__FILE__,__LINE__,cudaGetErrorString(err)); \
  std::exit(1); } } while (0)
__global__ void add(const float* a, const float* b, float* c, size_t n) {
  for (size_t i = size_t(blockIdx.x)*blockDim.x+threadIdx.x;
       i<n; i+=size_t(blockDim.x)*gridDim.x) c[i]=a[i]+b[i];
}
int main(int argc,char** argv) {
  size_t n=1u<<24;
  if(argc>2){std::fprintf(stderr,"usage: bandwidth [elements: 1..67108864]\n");return 2;}
  if(argc==2){char* end=nullptr; unsigned long long v=std::strtoull(argv[1],&end,10);
    if(!*argv[1]||*end||v<1||v>67108864){std::fprintf(stderr,"invalid element count\n");return 2;} n=size_t(v);}
  cudaDeviceProp prop{}; CUDA(cudaGetDeviceProperties(&prop,0));
  int driver=0,runtime=0; CUDA(cudaDriverGetVersion(&driver)); CUDA(cudaRuntimeGetVersion(&runtime));
  std::printf("GPU=%s CC=%d.%d driver=%d runtime=%d\n",prop.name,prop.major,prop.minor,driver,runtime);
  size_t bytes=n*sizeof(float); std::vector<float> a(n),b(n),c(n);
  for(size_t i=0;i<n;i++){a[i]=float(i%1024)*0.125f;b[i]=float(i%17)*0.25f;}
  float *da=nullptr,*db=nullptr,*dc=nullptr;
  CUDA(cudaMalloc(reinterpret_cast<void**>(&da),bytes));
  CUDA(cudaMalloc(reinterpret_cast<void**>(&db),bytes));
  CUDA(cudaMalloc(reinterpret_cast<void**>(&dc),bytes));
  cudaStream_t stream; CUDA(cudaStreamCreateWithFlags(&stream,cudaStreamNonBlocking));
  CUDA(cudaMemcpy(da,a.data(),bytes,cudaMemcpyHostToDevice));
  CUDA(cudaMemcpy(db,b.data(),bytes,cudaMemcpyHostToDevice));
  int blocks=int((n+255)/256); if(blocks>65535) blocks=65535;
  for(int i=0;i<10;i++) add<<<blocks,256,0,stream>>>(da,db,dc,n);
  CUDA(cudaGetLastError()); CUDA(cudaStreamSynchronize(stream));
  cudaEvent_t start,stop; CUDA(cudaEventCreate(&start)); CUDA(cudaEventCreate(&stop));
  constexpr int repeats=100; CUDA(cudaEventRecord(start,stream));
  for(int i=0;i<repeats;i++) add<<<blocks,256,0,stream>>>(da,db,dc,n);
  CUDA(cudaGetLastError()); CUDA(cudaEventRecord(stop,stream)); CUDA(cudaEventSynchronize(stop));
  float totalMs=0; CUDA(cudaEventElapsedTime(&totalMs,start,stop));
  CUDA(cudaMemcpy(c.data(),dc,bytes,cudaMemcpyDeviceToHost));
  size_t bad=0; double maxError=0;
  for(size_t i=0;i<n;i++){double e=std::abs(double(c[i])-double(a[i]+b[i]));
    if(!std::isfinite(c[i])||e>1e-6) ++bad; if(e>maxError) maxError=e;}
  double ms=totalMs/repeats;
  std::printf("N=%zu array_bytes=%zu mean_ms=%.6f max_abs_error=%g mismatches=%zu\n",n,bytes,ms,maxError,bad);
  if(ms>0) std::printf("effective_logical_GBps=%.3f (2 reads + 1 write; excludes host copies)\n",3.0*bytes/(ms*1e6));
  std::puts("Repeated addresses may hit L2. This is logical bandwidth, not measured HBM bandwidth.\nSmall-N results include GPU idle time from host submission. No Tensor Core speed claim is made.");
  CUDA(cudaEventDestroy(start)); CUDA(cudaEventDestroy(stop)); CUDA(cudaStreamDestroy(stream));
  CUDA(cudaFree(da)); CUDA(cudaFree(db)); CUDA(cudaFree(dc)); return bad?1:0;
}
