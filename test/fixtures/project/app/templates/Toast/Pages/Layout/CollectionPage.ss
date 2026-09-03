<form action="{$APIURL}">
    <% loop $CategoriesFilters %>
        <% if $Items.Count %>
            <label for="{$LabelName}">Filter by {$CategoryName}</label>
            <select name="category_{$CategoryID}">
                <% loop $Items.Sort('Name') %>
                    <option value="{$ID}">{$Name}</option>
                <% end_loop %>
            </select>
        <% end_if %>
    <% end_loop %>
</form>
