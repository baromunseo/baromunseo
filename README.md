# 바로문서

HWP·HWPX 문서를 **더블클릭하면 바로 열고, 인쇄하고, 간단히 고치는** 무료 윈도우 프로그램입니다. 한컴오피스가 없는 PC에서 받은 한글 파일을 보고 출력할 때 쓰려고 만들었습니다.

- 열기: 더블클릭, 최근 문서, 빈 문서, 양식으로 새 문서
- 인쇄: 인쇄, 미리보기, PDF로 저장, 여러 문서 한 번에 인쇄. 쪽 범위·모아찍기·양면은 윈도우 인쇄 창에서 고릅니다.
- 고치기: 글자·표 수정, 되돌리기, 문자표(Ctrl+F10), HWP·HWPX로 저장
- 저장할 때 이전 판을 30일 동안 백업 폴더에 남깁니다.
- 새 버전이 나오면 켤 때 알아서 받아 두고 다음 실행부터 바뀝니다. 인터넷이 없으면 지금 버전을 그대로 씁니다.

## 설치

[Releases](https://github.com/baromunseo/baromunseo/releases)에서 `baromunseo-Setup-버전.exe`를 받아 실행합니다. 서명 인증서가 없어서 처음에 "Windows의 PC 보호" 창이 뜰 수 있습니다. **추가 정보 → 실행**을 누르면 설치됩니다.

## 알아 둘 점

- 편집 엔진은 [rhwp](https://github.com/edwardkim/rhwp)(MIT, Edward Kim)입니다. 표시 정확도는 rhwp 수준이며, 복잡한 문서는 한컴오피스와 조금 다르게 보일 수 있습니다. 중요한 문서는 인쇄 전에 미리보기로 확인하세요.
- 한컴오피스·한글은 한글과컴퓨터의 상표이며, 이 프로그램은 한글과컴퓨터와 관련이 없습니다.
- 개인이 만든 무료 프로그램이라 사용 지원은 하지 않습니다. 문제는 Issues에 남겨 주시면 참고하겠습니다.

## 개발

```
npm install
npm start          # 실행
npm test           # 시험
npm run dist       # 설치 파일 만들기 (release/)
```

`studio/`는 rhwp-studio 0.9.0을 빌드한 결과물에 수식 글자 표시 수정을 더한 것입니다. 만드는 법은 [patches/README.md](patches/README.md)를 보세요.

## 라이선스

MIT. rhwp와 rhwp-desktop의 라이선스는 `third_party/`에 있습니다.
