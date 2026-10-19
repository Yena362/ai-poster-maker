# QR 포스터 메이커

링크와 문구를 넣으면 QR코드가 들어간 A4(2480×3508px, 300dpi) 포스터를 만들어 PNG·PDF로 저장합니다.
여러 줄을 붙여 넣으면 한 번에 여러 장을 만들어 PDF 한 파일이나 PNG 묶음(ZIP)으로 받을 수 있습니다.

- `index.html` : 앱 전체 (빌드 과정 없음)
- `character.png` : 기본 캐릭터 이미지 (같은 이름으로 바꾸면 기본값이 바뀜)

## 배포
Vercel에서 이 폴더를 Framework Preset "Other", Build Command 비움으로 배포하면 됩니다.
