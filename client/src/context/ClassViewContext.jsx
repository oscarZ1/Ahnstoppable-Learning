// src/context/ClassViewContext.jsx
// "View as student" for professors. ClassDashboard provides { preview }; the
// class cards call useClassView() instead of checking user.role themselves, so
// one switch flips the whole page to the student layout.
//
// The preview is display-only. The professor's account, token and data are
// unchanged, so the cards also block anything that would submit (votes,
// questions, comments) while previewing.
import { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';

export const ClassViewContext = createContext({ preview: false });

export const PREVIEW_MESSAGE = "This is a preview of the student view, so nothing was sent.";

export function useClassView() {
  const { user } = useAuth();
  const { preview } = useContext(ClassViewContext);
  const realProfessor = user?.role === 'professor';
  return {
    isProfessor: realProfessor && !preview,   // what to render
    preview:     realProfessor && preview,    // block submissions when true
  };
}
