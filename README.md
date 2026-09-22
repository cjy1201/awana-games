# AWANA 게임

AWANA Korea 게임 시간에 하는 게임을 태블릿에서 할 수 있게 만든 웹앱입니다.

## 구조
- `index.html`: 게임 모음 첫 화면. 게임 목록은 파일 안의 `GAMES` 배열에 있어요.
- `relay/`: Sparks 단거리 이어달리기
- `safari/`: Sparks 사파리
- 새 게임은 폴더를 하나 만들고 `GAMES`에 `ready: true`로 올린 뒤, `sw.js`의 `FILES`에도 추가해요.

## 게임
- **Sparks 사파리** (`safari/`): 콩주머니를 머리에 얹고 달려요. 너무 빨리 누르면 흔들려서 떨어지고, 떨어뜨리면 버튼을 꾹 눌러 다시 얹어요. 코치가 네모칸에서 다음 친구에게 콩주머니를 옮겨줘요.
- **Sparks 단거리 이어달리기** (`relay/`): 네 팀(빨강·파랑·초록·노랑)이 태블릿 하나에 둘러앉아 버튼을 연타해서 겨뤄요. 배턴 존, 색깔 핀 실격, 가운데 종료 핀까지 AWANA 규칙을 그대로 옮겼어요.

## 설치
1. 태블릿 브라우저로 https://cjy1201.github.io/awana-games/ 를 열어요.
2. iPad(Safari): 공유 → **홈 화면에 추가** / Android(Chrome): 메뉴 → **앱 설치**
3. 한 번 열어두면 인터넷이 없어도 실행돼요.

## 게임을 고친 뒤
`sw.js`의 `VERSION`을 올려야 이미 설치한 기기에도 새 버전이 퍼져요.

글꼴: [Jua](https://fonts.google.com/specimen/Jua) (SIL Open Font License, `fonts/OFL.txt`)
