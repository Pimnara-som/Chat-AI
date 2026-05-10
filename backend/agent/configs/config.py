# =============================================================================
# configs/config.py  —  Central config for Gemma Agent project
# v3.0 — Full Finetune on AMD MI300X (192 GB HBM3)
#         Dataset: Phonsiri/Glocal-Impact-Instruct-TH-EN-1K
# =============================================================================

# ── Model ──────────────────────────────────────────────────────────────────
MODEL_NAME      = "google/gemma-4-E4B-it"   # base model (128K context window)
LOCAL_MODEL_DIR = "./checkpoints"
# MAX_NEW_TOKENS: max tokens generated per hop
# Research tasks need longer chains → 16384 for thinking + action + HTML report
MAX_NEW_TOKENS  = 16384
TEMPERATURE     = 0.7
TOP_P           = 0.9

# ── Full Finetune (replaces LoRA/RORA) ────────────────────────────────────
# MI300X 192 GB VRAM — ample for full-precision finetuning of 4B model
# Model BF16:  ~8 GB | AdamW states: ~16 GB | Grads: ~8 GB | Activations: ~60 GB
# Estimated peak: ~95–110 GB  →  safe on 192 GB
FULL_FINETUNE        = True        # True = train all params, no LoRA adapter
GRAD_ACCUM_STEPS     = 4          # effective batch = RL_BATCH_SIZE × GRAD_ACCUM_STEPS
USE_GRADIENT_CKPT    = True       # mandatory for long-context training
FUSED_ADAM           = True       # ROCm supports fused AdamW (faster)
ENABLE_THINKING      = True       # ⭐ Gemma-4 Native Thinking (<think>...</think>)

# ── Hardware Backend ───────────────────────────────────────────────────────
# AMD MI300X  →  ROCm/HIP backend
# Set DEVICE_BACKEND = "rocm" to enable ROCm-specific paths.
# All torch.cuda.* calls are wrapped with device-agnostic helpers in train_grpo.py
DEVICE_BACKEND   = "rocm"         # "rocm" | "cuda" | "cpu"
GPU_VRAM_GB      = 192            # for memory budget calculations
CPU_RAM_GB       = 240
SCRATCH_DISK_TB  = 5.0            # 5 TB NVMe scratch

# ── Hugging Face Hub ───────────────────────────────────────────────────────
HF_USERNAME          = "Phonsiri"
HF_REPO_NAME         = f"{HF_USERNAME}/Gemma-4-E4B-it-PARL"  # PARL Full FT repo
PUSH_TO_HUB          = True
RESUME_FROM_HUB      = True
PUSH_EVERY_N_STEPS   = 5     # push checkpoint to Hub every N global steps

# ── SFT (kept for reference, not used in RL Full FT) ──────────────────────
SFT_EPOCHS      = 3
SFT_BATCH_SIZE  = 4
SFT_LR          = 2e-4
SFT_MAX_LEN     = 32768

# RL_MAX_LEN: max tokens of the FULL conversation history fed into backprop
# Gemma-4-E4B-it supports 128K natively.
# MI300X 192GB budget after model+optimizer+ref_model (~100GB):
#   Remaining: ~80 GB → activation per token ~0.17MB
#   65,536 tokens × 0.17MB ≈ 11 GB  ✅ safe
#   128,000 tokens × 0.17MB ≈ 21 GB  ✅ also fits (for eval)
# Training uses RL_MAX_LEN; eval can use full 128K.
RL_MAX_LEN      = 65536   # 50% of 128K — safe for K=4 Full FT on MI300X

# ── GRPO / RL ──────────────────────────────────────────────────────────────
# MI300X 192 GB: K=4 is safe start; bump to K=8 after validating memory budget
GRPO_NUM_GENERATIONS = 16         # K=16 (utilizes massive VRAM for faster learning)
GRPO_BETA            = 0.04       # KL coefficient
GRPO_CLIP_EPS        = 0.2        # gradient mask clip epsilon
RL_EPOCHS            = 1
RL_BATCH_SIZE        = 1          # 1 prompt per step; accum via GRAD_ACCUM_STEPS
RL_LR                = 5e-6       # lower LR for full finetune stability (was 1e-5)
RL_MAX_STEPS         = 500        # more steps — 1100 items dataset

# ── PARL Reward weights ────────────────────────────────────────────────────
W_PERF     = 1.0    # task success / impact alignment
W_PARALLEL = 0.1    # bonus for delegating to sub-agents
W_FINISH   = 0.2    # bonus per completed sub-task

# ── Agent Loop ─────────────────────────────────────────────────────────────
MAX_HOPS          = 15
MAX_SUBAGENT_HOPS = 100
TOOL_TIMEOUT_SEC  = 30

# ── Dataset ────────────────────────────────────────────────────────────────
# Primary: Phonsiri/Glocal-Impact-Instruct-TH-EN-1K (1,100 items, bilingual TH/EN)
DATASET_HF_NAME  = "Phonsiri/Glocal-Impact-Instruct-TH-EN-1K"
DATASET_SFT_PATH = "./1_sft_dataset/sft_data.jsonl"
DATASET_RL_PATH  = "./1_sft_dataset/glocal_rl_prompts.jsonl"  # cached local copy
