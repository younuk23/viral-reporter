import puppeteer, { Browser, Page, TimeoutError } from 'puppeteer';
import { INSTAGRAM_URL } from './constants';
import {
  DeactivatedIDError,
  InvalidUserNameOrPasswordError,
  PostNotExistError,
  PostURLisNotValid,
} from './errors';
import { ScreenshotPath, URL } from './types';

interface InsScarpper {
  login(userName: string, password: string): Promise<void>;
  exploreHashTag(tagName: string): Promise<Page>;
  findPost(
    page: Page,
    postURL: URL
  ): Promise<puppeteer.ElementHandle<HTMLAnchorElement>>;
  makeRedBorder(
    post: puppeteer.ElementHandle<HTMLAnchorElement>
  ): Promise<void>;
  screenshot(page: Page, path: string): Promise<ScreenshotPath>;
  close(): Promise<void>;
}

class InsScarpperImpl implements InsScarpper {
  private browser: Browser;
  private URL = INSTAGRAM_URL;
  private cookie: puppeteer.Protocol.Network.Cookie[] | null;

  constructor(browser: Browser) {
    this.browser = browser;
    this.cookie = null;
  }

  async login(userName: string, password: string) {
    const page = await this.browser.newPage();
    page.setExtraHTTPHeaders({
      'Accept-Language': 'en',
    });
    if (this.cookie) {
      page.deleteCookie(...this.cookie);
    }

    try {
      await page.goto(this.URL.ROOT, {
        waitUntil: 'networkidle0',
      });
      await page.type(`[aria-label*="username"]`, userName);
      await page.type(`[aria-label*=Password]`, password);
      await Promise.all([
        page.click(`[type="submit"]`),
        page.waitForNavigation(),
      ]);
      this.cookie = await page.cookies();

      if (page.url().startsWith('https://www.instagram.com/challenge/')) {
        throw new DeactivatedIDError();
      }
    } catch (e) {
      if (e instanceof TimeoutError && (await page.$('#slfErrorAlert'))) {
        throw new InvalidUserNameOrPasswordError();
      }

      throw e;
    } finally {
      page.close();
    }
  }

  async exploreHashTag(tagName: string): Promise<Page> {
    const page = await this.browser.newPage();
    page.setExtraHTTPHeaders({
      'Accept-Language': 'en',
    });
    await page.goto(encodeURI(this.URL.EXPLORE + tagName), {
      waitUntil: 'networkidle0',
      timeout: 0,
    });
    return page;
  }

  async findPost(
    page: Page,
    postURL: URL
  ): Promise<puppeteer.ElementHandle<HTMLAnchorElement>> {
    const postURLwithoutDomain = this.extractPostURL(postURL);

    const popularPostBox = await this.selectPopularPostBoxes(page);

    const allFindResult = await Promise.allSettled(
      popularPostBox.map((postBox) =>
        postBox.$(`a[href*="${postURLwithoutDomain}"]`)
      )
    );

    const post = allFindResult.filter(({ value }) => value !== null)[0].value;

    if (post !== undefined) {
      return post as puppeteer.ElementHandle<HTMLAnchorElement>;
    } else {
      throw new PostNotExistError(`포스트가 존재하지 않습니다: ${postURL}`);
    }
  }

  private extractPostURL(postURL: URL): string {
    const regexForFindPostURL = /p\/[\w-]+\/?/;
    const postURLwithoutDomain = postURL.match(regexForFindPostURL)?.[0];

    if (postURLwithoutDomain !== undefined) {
      return postURLwithoutDomain;
    } else {
      throw new PostURLisNotValid(`잘못된 형식의 포스트 URL입니다: ${postURL}`);
    }
  }

  private selectHeader = async (page: puppeteer.Page) => {
    const header = await page.$(`section > main > header`);

    if (header === null) {
      throw new Error(
        '해시태그 헤더 영역을 찾을 수 없습니다. 인스타그램 UI가 변경된 경우 이 에러가 발생할 수 있습니다.'
      );
    }

    return header;
  };

  // 클라이언트 요구사항: 상위 9개 게시물 대상으로만 검색 및 스크린샷 촬영
  // 2023.09.02 기준 인스타그램 UI에서는 한 줄당 3개씩 총 28개 게시물이 노출
  // 따라서 상위 3개 줄만 추출하도록 함
  private selectPopularPostBoxes = async (page: puppeteer.Page) => {
    const allPopularPostBoxes = await page.$$(
      'section > main > article > div > div > div > div'
    );

    const targetPopularPostBoxes = allPopularPostBoxes.slice(0, 3);

    if (targetPopularPostBoxes.length !== 3) {
      throw new Error(
        '인기게시물 영역을 찾을 수 없습니다. 인스타그램 UI가 변경된 경우 이 에러가 발생할 수 있습니다.'
      );
    }

    return targetPopularPostBoxes;
  };

  async screenshot(
    page: Page,
    screenshotPath: ScreenshotPath
  ): Promise<string> {
    const header = await this.selectHeader(page);
    const popularBoxes = await this.selectPopularPostBoxes(page);
    const lastPopularBox = popularBoxes[popularBoxes.length - 1];

    const headerBoxModel = await header.boxModel();
    const popularPostBoxModel = await lastPopularBox.boxModel();

    if (!headerBoxModel || !popularPostBoxModel) {
      throw new Error('스크린샷 영역을 찾을 수 없습니다.');
    }

    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: headerBoxModel.margin[0].x,
        y: headerBoxModel.margin[0].y,
        width: headerBoxModel.margin[2].x - headerBoxModel.margin[0].x,
        height: popularPostBoxModel.margin[2].y - headerBoxModel.margin[0].y,
      },
    });

    page.close();

    return screenshotPath;
  }

  async makeRedBorder(post: puppeteer.ElementHandle<HTMLAnchorElement>) {
    await post.evaluate((post) => {
      post.style.display = 'block';
      post.style.outline = 'solid 5px red';
    });
  }

  close() {
    return this.browser.close();
  }
}

export { InsScarpperImpl, InsScarpper };
