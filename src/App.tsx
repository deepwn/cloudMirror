import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import SearchResults from "./pages/SearchResults";
import Register from "./pages/Register";
import Settings from "./pages/Settings";
import DetailRouter from "./pages/DetailRouter";
import Docs from "./pages/Docs";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/docs/:id" element={<Docs />} />
        <Route path="/detail" element={<DetailRouter />} />
        <Route path="/register" element={<Register />} />
        <Route path="/dashboard" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
