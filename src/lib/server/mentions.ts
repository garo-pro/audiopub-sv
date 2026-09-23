/*
 * This file is part of the audiopub project.
 *
 * Copyright (C) 2026 the-byte-bender
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */
import { Op } from "sequelize";
import { User } from "$lib/server/database";
import { mentionCandidateGroups, mentionCandidates } from "$lib/mentions";
import type { ClientsideComment } from "$lib/types";

/**
 * The users the text @mentions, in the order they are first mentioned.
 * Candidates that are not accounts are dropped.
 */
export async function findMentionedUsers(text: string): Promise<User[]> {
    const candidates = mentionCandidates(text);
    if (candidates.length === 0) return [];

    const users = await User.findAll({
        where: { name: { [Op.in]: candidates } },
    });
    const byName = new Map(users.map((user) => [user.name, user]));
    const ordered: User[] = [];
    // Resolved the way splitMentions links them: "@garo!" is garo, unless
    // someone is actually called "garo!".
    for (const group of mentionCandidateGroups(text)) {
        const name = group.find((candidate) => byName.has(candidate));
        const user = name ? byName.get(name)! : undefined;
        if (user && !ordered.includes(user)) ordered.push(user);
    }
    return ordered;
}

function flatten(comments: ClientsideComment[]): ClientsideComment[] {
    return comments.flatMap((comment) => [
        comment,
        ...flatten(comment.replies ?? []),
    ]);
}

/**
 * Fills in `mentions` on each comment, replies included, with the names it
 * mentions that belong to real accounts, so the browser can link exactly
 * those. One query for the whole list. Returns the same array.
 */
export async function attachMentions(
    comments: ClientsideComment[],
): Promise<ClientsideComment[]> {
    const all = flatten(comments);
    const candidatesByComment = new Map(
        all.map((comment) => [comment, mentionCandidates(comment.content)]),
    );
    const allCandidates = new Set([...candidatesByComment.values()].flat());
    if (allCandidates.size === 0) return comments;

    const existing = new Set(
        (
            await User.findAll({
                where: { name: { [Op.in]: [...allCandidates] } },
                attributes: ["name"],
            })
        ).map((user) => user.name),
    );
    for (const [comment, candidates] of candidatesByComment) {
        // Every existing candidate, not just the one each mention resolves
        // to: the browser runs the same resolution when it renders.
        const mentions = candidates.filter((name) => existing.has(name));
        if (mentions.length > 0) comment.mentions = mentions;
    }
    return comments;
}
