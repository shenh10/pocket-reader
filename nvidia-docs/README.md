# NVIDIA Docs Pocket

自包含的 NVIDIA 文档整理页，适合作为 `my-pocket-reader` 下的一个静态子目录发布。

## 入口

- `index.html`：NVIDIA Docs 入口目录
- `nccl/index.html`：NCCL 专题页
- `nccl/env-tool.html`：NCCL 环境变量工具页别名
- `cuda/index.html`：CUDA Programming Guide 教程速读
- `cuda/programming-guide.html`：CUDA Programming Guide 教程速读
- `cuda/cublas-reference.html`：cuBLAS 速查
- `cuda/ptx-reference.html`：PTX ISA 速查

## 本地预览

```bash
cd /Users/linzhao/Downloads/coding/my-pocket-reader
python3 -m http.server 5175
```

然后打开：

```text
http://127.0.0.1:5175/nvidia-docs/
http://127.0.0.1:5175/nvidia-docs/cuda/programming-guide.html
```
