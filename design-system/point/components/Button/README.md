# Button

글자 버튼 네 가지: 주 버튼(primary), 보조 버튼(회색 면), 삭제 버튼(회색 면에 빨간 글자), 글자만 있는 버튼(편집 같은 상단 바 버튼).

- 한 화면에 주 버튼은 하나. 화면 아래 꽉 찬 버튼은 `pt-btn--block`(54px, 모서리 16).
- 줄 안·카드 안 버튼은 기본 44px, 모서리 14.
- 삭제는 빨간 면을 쓰지 않아요. 회색 면에 `danger` 글자.
- 굵기 600. 700 이상은 쓰지 않아요.
- 누르면 0.97로 빠르게 꾹, 떼면 스프링으로 돌아와요. 미리보기용 `is-hover`·`is-active`·`is-focus` 클래스가 있어요.

```html
<button class="pt-btn pt-btn--primary pt-btn--block">저장</button>
<button class="pt-btn">취소</button>
<button class="pt-btn pt-btn--danger">삭제</button>
<button class="pt-btn pt-btn--text">편집</button>
```
