# 백로그

## E1 회의록 파싱 [iter:1]

- [ ] B-01 결정 줄 파싱 — "결정:"으로 시작하는 줄을 문자열 배열로 반환 (area: be)
- [ ] B-02 액션아이템 파싱 — "- [ ] @담당 YYYY-MM-DD 내용" 줄을 {owner, due, text} 객체로 반환 (area: be)

## E2 검색과 출력 [iter:1]

- [ ] B-03 키워드 검색 함수 — 결정과 액션아이템을 대소문자 무시로 검색 (area: be) [solo:teammate-b]
- [ ] B-04 결과 HTML 목록 — 검색 결과를 HTML 문자열 하나로 렌더링 (area: fe)

## E3 필터와 CLI [iter:2]

- [ ] B-05 담당자별 필터 — 액션아이템을 담당자로 거른다 (area: be) [solo:teammate-b]
- [ ] B-06 CLI 진입점 — node src/cli.js <파일> <키워드> (area: fe)
