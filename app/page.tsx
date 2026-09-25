export default function Home() {
  return (
    <main className="site-shell" aria-label="打开本地边线 EDGE">
      <p>正在打开本地赛事工作台… <a href="/legacy.html">立即进入</a></p>
      <script dangerouslySetInnerHTML={{__html:"window.location.replace('/legacy.html'+window.location.search+window.location.hash)"}} />
    </main>
  );
}
