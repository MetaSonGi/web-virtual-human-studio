# VRM → Pixelle-Video 연결

현재 VRM 캔버스를 PNG로 캡처하고, 대본을 Pixelle의 한국어 TTS와 디지털 휴먼 워크플로로 보내 MP4를 생성합니다. 실시간 VRM 모션 변환이 아닌 **이미지 기반 영상 생성**입니다.

## 설치

Python 3.11 이상이 필요합니다. 프로젝트와 별도의 작업 폴더에 공식 Pixelle-Video를 설치하세요.

```powershell
git clone https://github.com/ATH-MaaS/Pixelle-Video.git ../Pixelle-Video
python -m venv .venv
.venv\Scripts\python -m pip install -r bridge/requirements.txt
.venv\Scripts\python -m pip install -e ../Pixelle-Video
```

확인한 upstream 커밋은 `848b054e4fae40dabc62ec58e960b573e83793ac`입니다. 재현이 필요하면 Pixelle-Video 폴더에서 해당 커밋을 체크아웃하세요. Pixelle-Video의 Apache-2.0 라이선스 및 각 생성 모델의 조건이 별도로 적용됩니다.

## 생성 서비스 설정

Pixelle-Video 폴더의 `config.example.yaml`을 `config.yaml`로 복사하고 다음 중 사용할 서비스를 설정하세요.

- 기본 연결: `comfyui.runninghub_api_key`에 본인의 RunningHub API 키를 설정합니다. 기본 디지털 휴먼 워크플로는 `workflows/runninghub/digital_customize.json`입니다. 해당 워크플로 이용 권한·잔액이 있어야 합니다.
- 로컬 구성: 본인이 설치한 ComfyUI 디지털 휴먼 워크플로의 파일 경로를 `PIXELLE_WORKFLOW`에 지정합니다(예: `selfhost/digital_custom.json`, Pixelle의 `workflows/` 기준). `videoimage`와 `audio` 입력을 받아 영상 출력을 반환하도록 구성해야 합니다. 기본 저장소에는 로컬 디지털 휴먼용 모델이 자동 설치되지 않습니다.

대본은 입력 그대로 사용하며 LLM 대본 생성은 요청하지 않습니다. 음성은 Pixelle의 Edge-TTS 방식이므로 Microsoft 음성 서비스 연결이 필요합니다. `local`이라는 upstream 명칭은 오프라인 합성을 뜻하지 않습니다.

API 키를 채팅이나 프런트엔드에 입력하지 마세요. Pixelle의 로컬 `config.yaml`에만 보관하고 Git에 올리지 마세요.

## 실행

프로젝트 폴더에서 터미널 두 개를 엽니다.

```powershell
# 터미널 1
.venv\Scripts\python bridge/app.py --pixelle-home ../Pixelle-Video

# 터미널 2
npm run dev
```

브리지 서버는 `127.0.0.1:8787`에만 연결되며 Vite가 `/pixelle-api` 요청을 전달합니다. 정적 호스팅만으로 AI 생성은 동작하지 않습니다. 외부 배포 시 별도 인증 서버와 같은 경로의 리버스 프록시가 필요합니다. 로컬 개발 서버를 외부에 공개하지 마세요.

## 사용

1. VRM을 불러오고 얼굴이 잘 보이도록 카메라를 조절합니다.
2. `04 / AI 캐릭터 영상`에서 `현재 캐릭터 캡처`를 누릅니다. PNG를 따로 저장할 수도 있습니다.
3. 대본과 한국어 음성을 고르고 `Pixelle 연결 확인`을 누릅니다.
4. 설정 누락이 표시되면 먼저 설정합니다. `AI 영상 생성`은 설정이 확인된 후 활성화됩니다.
5. 생성 과정(음성 → 캐릭터 영상 → 다운로드)을 기다린 뒤 영상 미리보기 또는 MP4 다운로드를 사용합니다.

새로고침하면 마지막 작업 ID로 상태 확인을 재개합니다. `생성 대기 중단`은 로컬 대기를 중단하며 외부 서비스의 실행·비용 취소를 보장하지 않습니다. 생성 파일·캡처·대본은 `bridge/.jobs/`에 남습니다. 필요 없을 때 직접 지울 수 있습니다.

모델 파일은 전송하지 않지만 **캡처와 대본은 설정된 TTS/생성 서비스에 전달**됩니다. 자신이 사용 권한을 보유한 캐릭터와 대본을 사용하세요. 생성 모델에 따라 3D·애니메이션 캐릭터 품질과 외형 일관성은 달라집니다.

## 검증과 한계

```powershell
.venv\Scripts\python -m pytest bridge -q
npm test
npm run build
```

브리지 테스트는 가짜 생성 어댑터를 사용해 요청 검증, 비설정 상태, 진행 상태, 결과 제공, 취소, 재시작 복구, 오류 정보 비공개를 검증합니다. 이 테스트가 실제 AI 영상 생성 성공을 뜻하지 않습니다. 실제 생성에는 본인의 작동하는 워크플로·서비스 설정이 필요합니다.
