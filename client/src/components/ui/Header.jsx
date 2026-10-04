// src/components/ui/Header.jsx
// Top bar on every page (rendered once in App.jsx): the centered brand and
// tagline, with the menu on the right when someone is signed in. The empty first column mirrors the right one so the brand stays
// truly centered whatever the menu's width.
import React from "react";
import DropdownMenu from "./DropdownMenu";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

function Header() {
  const navigate = useNavigate();
  const { user } = useAuth();
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-2 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-6 lg:p-8">
      <div aria-hidden="true" />

      <button
        type="button"
        onClick={() => navigate(user ? "/home" : "/")}
        className="flex flex-col items-center text-center cursor-pointer"
      >
        <h2 className="text-orange-500 dark:text-orange-400 font-bold text-xl sm:text-2xl lg:text-4xl tracking-tight">
          AHNSTOPPABLE LEARNING
        </h2>
        <span className="text-green-600 dark:text-green-400 font-bold text-sm sm:text-base lg:text-xl tracking-tight">
          freely ask, freely learn
        </span>
      </button>

      <div className="flex items-center justify-self-end gap-2">
        {/* Home / Sign Out only make sense when signed in */}
        {user && <DropdownMenu />}
      </div>
    </header>
  );
}

export default Header;
