# 실제 검증 결과

- 환경: Windows, Node.js 24.22.1, Chromium (Playwright), 로컬 Vite 서버
- 의존성 설치 성공, npm audit: 취약점 0개
- TypeScript 타입 검사 및 Vite 프로덕션 빌드 성공
- Vitest: 4개 테스트 통과 (RMS/노이즈 게이트/범위 제한, 시간 기반 스무딩, WebM 지원 선택, 실제 VRMExpressionManager에서 놀람/기쁨의 입 억제를 해제하여 입 morph bind에 립싱크 가중치가 적용되고 종료 시 설정이 복원되는지 확인)
- Playwright: 3개 테스트 통과, 건너뜀 없음
  - 초기 캔버스 렌더링, 녹화 버튼 상태, 잘못된 VRM 오류와 복구
  - 마이크 권한 거부 안내
  - 공식 three-vrm VRM1_Constraint_Twist_Sample.vrm 파싱, 가상 마이크 권한 및 합성 오디오 입력 활성화, 녹화 2회 반복, WebM 디코딩 및 영상 1개/음성 1개 트랙 확인, 마이크 트랙 종료 확인, 미처리 브라우저 오류 없음

가상 마이크를 사용한 자동 검증입니다. 실제 마이크 장치의 음질이나 사람이 말할 때의 시각적인 립싱크 품질, 모든 모델의 VRM 0.x 호환성, Safari/Firefox는 별도로 확인하지 않았습니다. 빌드에는 Three.js/VRM 번들 크기 경고가 있으며 빌드는 정상 완료됩니다.

검증 모델은 작업용 폴더에서만 사용했으며 이 저장소/압축 파일에는 포함하지 않았습니다.
