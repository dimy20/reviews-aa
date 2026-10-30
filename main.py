from langdetect import detect
from typing import Literal

Lang = Literal["en","es","pt"]

def detect_lang(text: str) -> Lang:
    return detect(text)

def main():
    print(detect_lang("hola como estas"))
if __name__ == "__main__":
    main()
