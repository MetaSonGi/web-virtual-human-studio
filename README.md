# Web Virtual Human Studio

브라우저에서 VRM 아바타를 불러와 마이크 음량으로 입을 움직이고, 캔버스 영상과 마이크 음성을 WebM으로 저장하는 로컬 스튜디오입니다.

## 실행

Node.js 22.12 이상(검증 환경: 24.22.1)과 npm이 필요합니다.

```sh
npm install
npm run dev
```

표시되는 localhost 주소를 여세요. 배포본은 `npm run build`, 로컬 미리보기는 `npm run preview`입니다. `dist/`를 정적 호스팅에 배포할 수 있습니다. 마이크는 HTTPS 또는 localhost에서만 사용할 수 있습니다. 최신 데스크톱 Chrome/Edge를 권장합니다. WebGL, Web Audio, canvas.captureStream, MediaRecorder 및 WebM 코덱 지원이 필요합니다.

## 사용법

1. 이용 권한을 보유한 `.vrm` 파일을 선택합니다. VRM 0.x와 1.0을 three-vrm 로더로 처리하고 구형 모델 방향을 보정합니다.
2. 마우스 드래그로 회전, 휠로 확대, 오른쪽 드래그로 이동합니다. 카메라 초기화로 전체 모델을 다시 맞춥니다.
3. 표정을 선택합니다. 모델에 없는 표정은 선택할 수 없습니다.
4. 마이크 시작을 누르고 브라우저 권한을 허용합니다. 감도로 입 벌림 정도를 조절합니다.
5. 녹화 시작 → 녹화 종료 → WebM 다운로드를 누릅니다. 모델과 활성 마이크가 있어야 녹화를 시작할 수 있습니다.
6. 마이크 종료로 장치 사용을 해제합니다. 페이지 종료 시에도 장치·렌더러·모델 자원을 정리합니다.

녹화 중에는 모델 변경과 마이크 종료를 잠그고, 인코더 해상도를 유지합니다. 녹화 종료 후에도 마이크는 계속 켜져 있으므로 필요하면 직접 종료하세요. 마이크 입력은 스피커에 재생하지 않아 피드백을 방지합니다. 직전 다운로드는 다음 녹화가 완료될 때 교체됩니다. 녹화 데이터는 메모리에 보관하므로 긴 녹화는 메모리가 부족해질 수 있습니다. 페이지를 닫기 전에 다운로드하세요.

## 구현 범위

- Vite + TypeScript + Three.js + `@pixiv/three-vrm`, npm 모듈 및 Three.js addons 정식 import 사용
- 로컬 VRM 파일 파싱, 조명, OrbitControls, 모델 교체 시 기존 리소스 해제
- Web Audio 시간 영역 RMS, 노이즈 게이트, 프레임 시간 기반 스무딩 → `aa` 표정
- 기본/기쁨/화남/슬픔/편안함/놀람 표정
- 캔버스 30fps + 복제한 마이크 오디오 트랙을 MediaRecorder로 녹화, 지원 WebM 코덱 자동 선택
- 권한 거부·장치 없음·장치 중단·잘못된 모델·미지원 브라우저 오류 안내
- 녹화 트랙, 오디오 컨텍스트, Object URL, RAF, OrbitControls, GPU 리소스 정리

립싱크는 **음량에 따른 입 벌림**입니다. 음소 인식, AI 대화, TTS, 웹캠 추적, 자동 모션은 포함하지 않습니다. `aa` 표정이 없는 모델은 입이 움직이지 않을 수 있습니다. 모델의 표정 override 설정에 따라 감정 표정이 입 움직임을 억제할 수 있습니다.

## 검증

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

기본 E2E는 초기 화면/잘못된 VRM 복구/권한 거부를 검사합니다. 전체 VRM·녹화 검증에는 본인이 사용 가능한 모델 경로를 지정하세요. 모델은 저장소에 포함하지 않습니다.

```powershell
$env:VRM_TEST_MODEL = 'C:\models\your-model.vrm'
npm run test:e2e
```

전체 E2E는 실제 VRM 로더, Chromium 가상 마이크, 녹화 2회 반복, 생성 WebM 재생 및 오디오/비디오 각 1개 트랙, 마이크 트랙 해제를 검사합니다. 실제 사람의 마이크 입력, 모든 브라우저/장치와 모든 VRM 모델의 호환성을 보장하는 검사는 아닙니다. 모델 경로를 지정하지 않으면 해당 전체 E2E는 건너뜁니다.

## 개인정보 및 모델·라이선스 주의

앱에는 업로드 API나 분석 서비스가 없으며 선택한 파일과 녹화는 브라우저에서 처리합니다. 모델이 외부 리소스 URL을 포함하면 로더가 해당 URL을 요청할 수 있습니다. 신뢰할 수 있는 모델을 사용하세요.

소스 코드는 MIT 라이선스입니다. Three.js와 three-vrm 등 의존성은 각각의 라이선스를 따릅니다. **코드 라이선스는 아바타·텍스처·캐릭터·음성의 이용 권한을 부여하지 않습니다.** 모델 메타데이터와 배포자의 이용 조건(방송, 상업적 이용, 재배포, 수정, 크레딧, 금지 콘텐츠)을 직접 확인하세요. 다른 사람의 목소리나 초상이 포함된 녹화는 당사자 동의를 확보하세요. 샘플 모델을 무단으로 저장소에 추가하지 마세요.

## 참고

- [three-vrm 공식 문서](https://pixiv.github.io/three-vrm/docs/modules/three-vrm)
- [Three.js 설치 및 addons](https://threejs.org/manual/pages/installation.html)
- 검증용 모델 출처: [pixiv/three-vrm 공식 예제](https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models). 테스트 작업 폴더에서만 사용하며 배포물에는 포함하지 않습니다.
