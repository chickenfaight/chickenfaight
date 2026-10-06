"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

type Props = {
  meId: string;
  otherId: string;
};

type FriendsRead = {
    id: string;
    friend_ids: string[];
}

export default function AddFriendButton({ meId, otherId }: Props) {
	
  const buttonFunc = () => {
	try {
      const friends = api("/api/v1/friends/add", controller.signal, "POST", { id: meId, other_id: otherId });
    } catch (err) {
      console.log(err)
    }
  }
	
  return (
    <div className={`mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#e53848] text-sm font-bold text-white transition-colors enabled:hover:bg-[#c92d3c] disabled:cursor-not-allowed disabled:opacity-50 ${focus}`}>
	  <button type="button" onClick={buttonFunc}>
	    Add Friend
	  </button>
    </div>
  );
}